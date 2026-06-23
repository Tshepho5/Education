const db = require('../db/db'); 
const aiTutor = require('../services/aiTutorService');
const emailService = require('../services/emailService');

exports.getWorkload = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT subjects, subject_codes, grades_taught, classes_taught FROM employees WHERE user_id = $1',
            [req.user.id]
        );
        res.json(result.rows[0] || { subjects: [], subject_codes: [], grades_taught: [], classes_taught: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getClassList = async (req, res) => {
    const { subject, grade } = req.query;
    try {
        const result = await db.query(
            `SELECT id, learner_name, learner_surname, learner_number, stream 
             FROM children 
             WHERE grade = $1 AND $2 = ANY(subjects)
             ORDER BY learner_surname ASC`,
            [grade, subject]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getMyTextbooks = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, subject, grade, file_path, upload_date FROM textbooks WHERE teacher_id = $1 ORDER BY upload_date DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.uploadTextbook = async (req, res) => {
    const subject = aiTutor.normalizeSubject(req.body.subject);
    const grade = req.body.grade;
    if (!req.file) return res.status(400).json({ error: 'Please upload a PDF textbook.' });

    try {
        await db.query(
            'INSERT INTO textbooks (subject, grade, file_path, teacher_id) VALUES ($1, $2, $3, $4)',
            [subject, grade, req.file.path, req.user.id]
        );
        res.json({ message: 'Textbook uploaded and indexed successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTopicsFromTextbook = async (req, res) => {
    const subject = aiTutor.normalizeSubject(req.query.subject);
    const { grade, topic } = req.query;

    try {
        const bookRes = await db.query(
            `SELECT file_path FROM textbooks 
             WHERE (LOWER(subject) = LOWER($1) OR (LOWER($1) = 'mathematics' AND LOWER(subject) = 'maths') OR (LOWER($1) = 'physical sciences' AND LOWER(subject) = 'physics')) 
             AND grade = $2 AND teacher_id = $3 ORDER BY upload_date DESC LIMIT 1`, 
            [subject, grade, req.user.id]
        );

        let contentSnippet = null;
        if (bookRes.rows.length > 0) {
            contentSnippet = await aiTutor.getTextbookContent(bookRes.rows[0].file_path, 8000);
        }

        // Fallback to static curriculum if no textbook exists
        if (!contentSnippet) {
            const subjectKey = Object.keys(aiTutor.aiCurriculum).find(k => k.toLowerCase() === subject.toLowerCase());
            const fallbackTopics = (aiTutor.aiCurriculum[subjectKey] || [])
                .filter(t => !t.grade || Number(t.grade) === Number(grade))
                .map(t => t.topic);
            
            if (fallbackTopics.length > 0) return res.json({ topics: fallbackTopics });
            return res.status(404).json({ error: 'No source material found for this subject.' });
        }

        const contextGoal = topic 
            ? `searching for sub-sections, key sections, or specific academic concepts inside the main topic: "${topic}"` 
            : "extracting the main Table of Contents, major chapters, or primary modules";

        const prompt = `Act as an expert academic coordinator. Scan the following content from a Grade ${grade} ${subject} textbook.
        Focus on ${contextGoal}. 
        Identify and list specific academic components found in the text that fall under this scope.
        Return the response as a JSON object with a key "topics" containing an array of strings. Do not include introductory text or markdown formatting.
        Content: \n\n${contentSnippet}`;

        const aiResponse = await aiTutor.safeAICall(prompt, true);
        if (aiResponse.error) return res.status(500).json({ error: aiResponse.error });
        res.json({ topics: aiTutor.parseAIJSON(aiResponse) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to extract topics: ' + err.message });
    }
};

exports.generateAIQuestions = async (req, res) => {
    const subject = aiTutor.normalizeSubject(req.body.subject);
    const { topic, grade, count = 5 } = req.body;
    
    let contextText = "";
    try {
        // Fetch the most recently uploaded textbook for this specific subject and grade
        const bookRes = await db.query(
            `SELECT file_path FROM textbooks 
             WHERE (LOWER(subject) = LOWER($1) OR (LOWER($1) = 'mathematics' AND LOWER(subject) = 'maths') OR (LOWER($1) = 'physical sciences' AND LOWER(subject) = 'physics')) 
             AND grade = $2 AND teacher_id = $3 ORDER BY upload_date DESC LIMIT 1`, 
            [subject, grade, req.user.id]
        );
        const snippet = await aiTutor.getTextbookContent(bookRes.rows[0]?.file_path, 5000);
        if (snippet) {
            contextText = `\nSource material from the textbook:\n\n${snippet}`;
        }
    } catch (err) { console.error("[TEXTBOOK ERROR]", err); }

    const prompt = `Act as an expert Grade ${grade} ${subject} generative AI coordinator specializing in the South African CAPS curriculum. 
    Generate ${count} high-quality academic assignment questions for the topic: "${topic}". 
    ${contextText ? "Use the following textbook material as your primary source of truth for terminology and level of detail: " + contextText : "Ensure the questions align with the standard CAPS curriculum."}
    IMPORTANT: Every object must include a precise 'answer' field for automated marking.
    If this is Mathematics, use LaTeX for all formulas (e.g. \\frac{1}{2}). Ensure backslashes are doubled in your JSON string.
    Return the response as a JSON object with a key "questions" containing an array of objects. Each object must have an 'id', 'question', 'type', and 'answer'.`;

    try {
        const aiResponse = await aiTutor.safeAICall(prompt, true);
        if (aiResponse.error) return res.status(500).json({ error: aiResponse.error });
        res.json({ questions: aiTutor.parseAIJSON(aiResponse) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate questions: ' + error.message });
    }
};

exports.publishAssignment = async (req, res) => {
    const { title, grade, questions, stream_target = 'General' } = req.body;
    const subject = aiTutor.normalizeSubject(req.body.subject);

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Cannot publish an empty assignment. Please generate questions first.' });
    }

    try {
        const result = await db.query(
            `INSERT INTO announcements (title, content, role_target, author_id, grade_target, stream_target, is_assignment, assignment_data, subject_target) 
             VALUES ($1, $2, 'learner', $3, $4, $5, TRUE, $6, $7) RETURNING *`,
            [title, `New ${subject} Assignment: ${title}`, req.user.id, grade, stream_target, JSON.stringify(questions), subject]
        );

        // Notify learners via email
        const learners = await db.query(
            `SELECT u.email, c.learner_name FROM users u 
             JOIN children c ON c.learner_user_id = u.id 
             WHERE c.grade = $1 AND $2 = ANY(c.subjects) 
             AND (c.stream = $3 OR c.stream = 'General')`,
            [grade, subject, stream_target]
        );

        for (const learner of learners.rows) {
            const tpl = emailService.templates.newAssignment(learner.learner_name, subject, title);
            await emailService.send(learner.email, tpl.subject, tpl.body);
        }

        res.json({ message: 'Assignment published successfully!', assignment: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
