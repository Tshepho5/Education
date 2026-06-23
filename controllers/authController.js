const db = require('../db/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const emailService = require('../services/emailService');

const PUBLIC_REGISTRATION_ROLES = new Set(['parent']);

const generateResetCode = () => {
    const crypto = require('crypto');
    return crypto.randomInt(100000, 1000000).toString();
};

const findResetAccount = async (identifier) => {
    const normalized = (identifier || '').toString().toLowerCase().trim();
    if (!normalized) return null;

    const result = await db.query(
        `SELECT u.id, u.email, r.name AS role_name, c.learner_number, p.email AS parent_email
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN children c ON c.learner_user_id = u.id
         LEFT JOIN users p ON c.parent_id = p.id
         WHERE LOWER(u.email) = LOWER($1) OR c.learner_number = $1
         LIMIT 1`,
        [normalized]
    );

    return result.rows[0] || null;
};

const getResetRecipient = (account) => {
    if (!account) return null;
    if (account.role_name === 'learner') return account.parent_email;
    return account.email;
};

const validatePassword = (password) => {
    if (!password) return "Password is required.";
    if (typeof password !== 'string') return "Invalid password format.";
    const minLength = 8;
    if (password.length < minLength) return `Password must be at least ${minLength} characters long.`;
    if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter.";
    if (!/\d/.test(password)) return "Password must contain at least one number.";
    if (!/[!@#$%^&*(),.?":{}|<> ]/.test(password)) return "Password must contain at least one special character.";
    return null;
};

exports.register = async (req, res) => {
    const { email, password, confirm_password, role, full_name, surname, id_number, dob, phone, physical_address, country, race, parent_type } = req.body;
    const requestedRole = (role || '').toLowerCase().trim();
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    if (!PUBLIC_REGISTRATION_ROLES.has(requestedRole)) {
        return res.status(403).json({ error: 'Public registration is only available for parent accounts.' });
    }

    if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });
    
    // Specific validation for parent_type if role is 'parent'
    if (requestedRole === 'parent' && !parent_type) {
        return res.status(400).json({ error: 'Parent type is required for parent registration.' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const roleResult = await db.query('SELECT id FROM roles WHERE name = $1', [requestedRole]);
        if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' });

        let dobISO = dob?.includes('/') ? dob.split('/').reverse().join('-') : null;
        const query = `INSERT INTO users (email, password_hash, role_id, full_name, surname, id_number, dob, phone, physical_address, country, race, parent_type)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, email`;
        const result = await db.query(query, [normalizedEmail, hash, roleResult.rows[0].id, full_name, surname, id_number, dobISO, phone, physical_address, country, race, parent_type || null]);

        const tpl = emailService.templates.registrationSuccess(full_name || normalizedEmail);
        await emailService.send(normalizedEmail, tpl.subject, tpl.body);
        res.json({ message: 'User registered', user: result.rows[0], role: requestedRole });
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.login = async (req, res) => {
    const { email, password } = req.body; // 'email' field now accepts email OR learner number
    try {
        const identifier = email.trim();
        const result = await db.query(
            `SELECT u.id, u.email, u.password_hash, r.name as role_name 
             FROM users u 
             LEFT JOIN roles r ON u.role_id = r.id 
             LEFT JOIN children c ON c.learner_user_id = u.id
             WHERE TRIM(LOWER(u.email)) = LOWER($1) OR c.learner_number = $1`, 
            [identifier]
        );

        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, role: user.role_name }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, role: user.role_name, user: { id: user.id, email: user.email } });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.forgotPassword = async (req, res) => {
    const { email, identifier } = req.body;
    try {
        const account = await findResetAccount(identifier || email);
        if (!account) return res.status(404).json({ error: 'User does not exist.' });

        const recipient = getResetRecipient(account);
        if (!recipient) return res.status(400).json({ error: 'No recovery email is available for this account.' });

        const otp = generateResetCode();
        const expiry = new Date(Date.now() + 15 * 60 * 1000);
        await db.query('UPDATE users SET reset_code = $1, reset_expiry = $2 WHERE id = $3', [otp, expiry, account.id]);

        const tpl = emailService.templates.forgotPassword(otp);
        await emailService.send(recipient, tpl.subject, tpl.body);
        res.json({ message: 'A reset code has been sent to your email.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.verifyOTP = async (req, res) => {
    const { email, identifier, code } = req.body;
    try {
        const account = await findResetAccount(identifier || email);
        if (!account) return res.status(400).json({ error: 'Invalid or expired code.' });

        const result = await db.query('SELECT id FROM users WHERE id = $1 AND reset_code = $2 AND reset_expiry > NOW()', [account.id, code]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code.' });
        res.json({ message: 'Code verified.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.resetPassword = async (req, res) => {
    const { email, identifier, code, new_password } = req.body;
    try {
        const account = await findResetAccount(identifier || email);
        if (!account) return res.status(400).json({ error: 'Invalid or expired code.' });

        const check = await db.query('SELECT id FROM users WHERE id = $1 AND reset_code = $2 AND reset_expiry > NOW()', [account.id, code]);
        if (check.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired code.' });

        const pwError = validatePassword(new_password);
        if (pwError) return res.status(400).json({ error: pwError });

        const hash = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password_hash = $1, reset_code = NULL, reset_expiry = NULL WHERE id = $2', [hash, account.id]);

        const recipient = getResetRecipient(account);
        if (recipient) await emailService.send(recipient, emailService.templates.passwordResetSuccess().subject, emailService.templates.passwordResetSuccess().body);
        res.json({ message: 'Password updated successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.validatePassword = validatePassword;
