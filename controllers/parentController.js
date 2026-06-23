const db = require('../db/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../services/emailService');

exports.registerChild = async (req, res) => {
    const { full_name, surname, id_number, grade, stream, dob, phone, physical_address, country, race } = req.body;
    const gradeInt = parseInt(grade, 10);

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const setupCode = crypto.randomInt(100000, 1000000).toString();
        const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const subjectRes = await client.query("SELECT name FROM subjects WHERE (grade = $1 OR (grade < 10 AND $1 < 10)) AND (stream = $2 OR stream = 'General')", [gradeInt, gradeInt >= 10 ? stream : 'General']);
        const autoSubjects = subjectRes.rows.map(r => r.name);

        const year = new Date().getFullYear();
        const countRes = await client.query('SELECT COUNT(*) FROM children');
        const learnerNumber = `${year}${(parseInt(countRes.rows[0].count) + 1).toString().padStart(4, '0')}`;

        // Use unique internal email for learner to satisfy DB UNIQUE constraint
        const internalLearnerEmail = `${learnerNumber}@fusion.high`;

        // Check if ID number already exists
        const existing = await client.query('SELECT id FROM users WHERE id_number = $1', [id_number]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Learner with this ID Number already exists.' });

        const unusablePassword = crypto.randomBytes(32).toString('hex');
        const learnerHash = await bcrypt.hash(unusablePassword, 10);
        const roleId = await client.query("SELECT id FROM roles WHERE name = 'learner'");
        
        let dobISO = dob?.includes('/') ? dob.split('/').reverse().join('-') : dob;

        const userRes = await client.query(
            `INSERT INTO users (email, password_hash, role_id, parent_id, full_name, surname, id_number, dob, phone, physical_address, country, race, reset_code, reset_expiry) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [internalLearnerEmail, learnerHash, roleId.rows[0].id, req.user.id, full_name, surname, id_number, dobISO, phone, physical_address, country, race, setupCode, expiry]
        );

        await client.query(
            `INSERT INTO children (learner_name, learner_surname, learner_id_number, grade, stream, subjects, parent_id, learner_user_id, learner_number) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [full_name, surname, id_number, gradeInt, stream, autoSubjects, req.user.id, userRes.rows[0].id, learnerNumber]
        );

        await client.query('COMMIT');
        
        // Fetch the registrar details to send them the learner credentials
        const parentRes = await db.query('SELECT u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1', [req.user.id]);
        const { email: registrarEmail, role: registrarRole } = parentRes.rows[0];

        // Send setup instructions to the registrar without exposing a plaintext password.
        const tpl = emailService.templates.learnerAdmission(full_name, surname, learnerNumber, grade, setupCode, registrarRole);
        await emailService.send(registrarEmail, tpl.subject, tpl.body);

        res.json({ message: 'Learner registered. Setup instructions were sent to the registrar email.', learnerNumber });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally { client.release(); }
};

exports.getChildren = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT c.id, c.learner_name, c.learner_surname, c.learner_id_number, c.grade, c.stream,
                    c.subjects, c.parent_id, c.learner_user_id, c.learner_number, c.created_at,
                    u.email as learner_email
             FROM children c
             JOIN users u ON c.learner_user_id = u.id
             WHERE c.parent_id = $1`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
