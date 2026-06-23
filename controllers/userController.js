const db = require('../db/db');
const emailService = require('../services/emailService');

exports.getProfile = async (req, res) => {
    try {
        const userRes = await db.query(
            `SELECT u.id, u.email, u.full_name, u.surname, u.phone, u.id_number, u.physical_address, u.country, u.race, r.name as role 
             FROM users u 
             JOIN roles r ON u.role_id = r.id 
             WHERE u.id = $1`,
            [req.user.id]
        );
        
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User profile not found' });
        }

        const user = userRes.rows[0];
        if (user.role === 'learner') {
            const childRes = await db.query(
                `SELECT id, learner_name, learner_surname, learner_id_number, grade, stream,
                        subjects, parent_id, learner_user_id, learner_number, created_at
                 FROM children
                 WHERE learner_user_id = $1`,
                [req.user.id]
            );
            user.academic = childRes.rows[0] || null;
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateProfile = async (req, res) => {
    const userId = req.user.id; // Assume userId comes from your Auth middleware
    const updates = req.body;
    
    // Ensure 'email' is in the allowed fields so users can edit it
    const allowedFields = ['full_name', 'surname', 'phone', 'physical_address', 'country', 'race', 'email'];
    const keys = Object.keys(updates).filter(key => allowedFields.includes(key));

    if (keys.length === 0) {
        return res.status(400).json({ error: "No valid fields provided for update" });
    }
    
    try {
        // 1. Fetch current user data to check for email changes
        const currentUserResult = await db.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
        if (currentUserResult.rowCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        const oldEmail = currentUserResult.rows[0].email.toLowerCase();

        // 2. Building the dynamic query: UPDATE users SET field1=$1, field2=$2 WHERE id=$3
        const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
        const values = keys.map(key => key === 'email' ? updates[key].toLowerCase().trim() : updates[key]);
        
        // Add the user ID as the last parameter
        values.push(userId);
        const queryText = `UPDATE users SET ${setClause} WHERE id = $${values.length} RETURNING id, full_name, email`;

        const result = await db.query(queryText, values);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const updatedUser = result.rows[0];
        const newEmail = updatedUser.email.toLowerCase();

        // 3. If email changed, send a confirmation email
        if (updates.email && newEmail !== oldEmail) {
            const subject = 'Email Change Confirmation';
            const body = `Profile Update Notification: Your email address has been successfully changed from ${oldEmail} to ${newEmail}.`;
            // Note: If you want HTML support in emailService.send, you can update that service, 
            // but here we use the existing text-based send method for consistency.
            await emailService.send(newEmail, subject, body);
        }

        res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser
        });
    } catch (err) {
        console.error('Database Error:', err);
        
        // Handle unique constraint violations (e.g., email already exists)
        if (err.code === '23505') {
            return res.status(409).json({ error: "Username or Email already in use" });
        }
        
        res.status(500).json({ error: "Internal server error" });
    }
};
