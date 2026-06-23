const db = require('../db/db');

exports.createAnnouncement = async (req, res) => {
    const { title, content, role_target = 'all', grade_target, stream_target, subject_target } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO announcements (title, content, role_target, author_id, grade_target, stream_target, subject_target) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [title, content, role_target, req.user.id, grade_target, stream_target, subject_target]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.getAnnouncements = async (req, res) => {
    try {
        let result;
        if (req.user.role === 'learner') {
            const learnerRes = await db.query('SELECT grade, stream, subjects FROM children WHERE learner_user_id = $1', [req.user.id]);
            if (learnerRes.rows.length === 0) return res.status(404).json({ error: 'Learner profile not found' });
            const { grade, stream, subjects } = learnerRes.rows[0];

            result = await db.query(
                `SELECT * FROM announcements 
         WHERE (role_target = 'learner' OR role_target = 'all')
         AND (grade_target IS NULL OR grade_target = $1)
         AND (stream_target IS NULL OR stream_target = $2 OR stream_target = 'General')
         AND (subject_target IS NULL OR subject_target = ANY($3::text[]))
         ORDER BY created_at DESC`,
                [grade, stream, subjects]);
        } else {
            const role_filter = req.query.role_target || req.user.role;
            result = await db.query('SELECT * FROM announcements WHERE role_target = $1 OR role_target = \'all\' ORDER BY created_at DESC', [role_filter]);
        }
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
