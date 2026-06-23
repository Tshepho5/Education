const db = require('../db/db'); // Points to the database pool in the db folder
const aiTutor = require('../services/aiTutorService');

exports.getSubjects = async (req, res) => {
    try {
        const learnerRes = await db.query(
            'SELECT subjects, grade, stream FROM children WHERE learner_user_id = $1',
            [req.user.id]
        );
        if (learnerRes.rows.length === 0) return res.status(404).json({ error: 'Learner not found' });
        
        const data = learnerRes.rows[0];

        // Check which of the learner's subjects have textbooks uploaded for their grade
        const bookRes = await db.query('SELECT DISTINCT subject FROM textbooks WHERE grade = $1', [data.grade]);
        const subjectsWithBooks = bookRes.rows.map(r => r.subject.toLowerCase());

        const subjectsWithAI = data.subjects.map(name => {
            const lowerName = aiTutor.normalizeSubject(name).toLowerCase();
            const hasBook = subjectsWithBooks.includes(lowerName);
            const inCurriculum = !!Object.keys(aiTutor.aiCurriculum).find(k => k.toLowerCase() === lowerName);
            return { name, aiEnabled: hasBook || inCurriculum, hasTextbook: hasBook };
        });
        res.json({ ...data, subjects: subjectsWithAI });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTopics = async (req, res) => {
    const subject = aiTutor.normalizeSubject(req.query.subject);
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    const searchSubject = subject;

    try {
        const learnerRes = await db.query('SELECT grade, stream FROM children WHERE learner_user_id = $1', [req.user.id]);
        if (learnerRes.rows.length === 0) return res.status(404).json({ error: 'Learner profile not found' });
        const learner = learnerRes.rows[0];

        // 1. Check for a subject-specific textbook first
        const bookRes = await db.query(
            `SELECT file_path FROM textbooks 
             WHERE (LOWER(subject) = LOWER($1) 
                OR (LOWER($1) = 'mathematics' AND LOWER(subject) = 'maths')
                OR (LOWER($1) = 'physical sciences' AND LOWER(subject) = 'physics')) 
             AND grade = $2 ORDER BY upload_date DESC LIMIT 1`, 
            [searchSubject, learner.grade]
        );

        const contentSnippet = await aiTutor.getTextbookContent(bookRes.rows[0]?.file_path);

        if (contentSnippet && contentSnippet.trim().length > 100) {
            try {
                const prompt = `Act as an academic coordinator for Grade ${learner.grade} ${searchSubject}. Scan the provided textbook content and extract the official list of academic chapters or lesson topics.
                Return the response as a JSON object with a key "topics" containing an array of strings.
                Content: \n\n${contentSnippet}`;

                const aiResponse = await aiTutor.safeAICall(prompt, true);
                const topicsList = aiTutor.parseAIJSON(aiResponse);

                if (topicsList.length > 0) {
                    return res.json(topicsList.map(t => ({ id: t, topic: t, isFromTextbook: true })));
                }
            } catch (pdfErr) {
                console.error("[PDF TOPICS ERROR] Falling back to curriculum:", pdfErr.message);
            }
        }

        // 2. Fallback to centralized curriculum if no textbook exists
        const subjectKey = Object.keys(aiTutor.aiCurriculum).find(k => k.toLowerCase() === searchSubject.toLowerCase());
        const filtered = (aiTutor.aiCurriculum[subjectKey] || []).filter(t => {
            // Robust grade check (numerical)
            const gradeMatch = !t.grade || Number(t.grade) === Number(learner.grade);
            
            // Robust stream check (case-insensitive + trim)
            const learnerStream = (learner.stream || "").toLowerCase().trim();
            const topicStream = (t.stream || "").toLowerCase().trim() || 'general';
            
            // Match if general or exact stream match or if learner stream is not set
            const streamMatch = topicStream === 'general' || topicStream === learnerStream || !learnerStream;
            
            return gradeMatch && streamMatch;
        });
        res.json(filtered.map(t => ({ id: t.id, topic: t.topic })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTask = async (req, res) => {
    const subject = aiTutor.normalizeSubject(req.query.subject);
    const { topicId } = req.query;

    const subjectKey = Object.keys(aiTutor.aiCurriculum).find(k => k.toLowerCase() === subject.toLowerCase());
    const task = (aiTutor.aiCurriculum[subjectKey] || []).find(t => t.id === topicId);

    const topicName = task ? task.topic : topicId;

    try {
        const learnerRes = await db.query('SELECT grade FROM children WHERE learner_user_id = $1', [req.user.id]);
        const grade = learnerRes.rows[0]?.grade || 10;

        // 1. Check for textbook context
        const bookRes = await db.query(
            `SELECT file_path FROM textbooks 
             WHERE (LOWER(subject) = LOWER($1) 
                OR (LOWER($1) = 'mathematics' AND LOWER(subject) = 'maths')
                OR (LOWER($1) = 'physical sciences' AND LOWER(subject) = 'physics')) 
             AND grade = $2 ORDER BY upload_date DESC LIMIT 1`, 
            [subject, grade]
        );
        
let contextText = await aiTutor.getTextbookContent(bookRes.rows[0]?.file_path, 10000, topicName);
        // If PDF extraction fails or topic is not found, contextText may be empty; continue with curriculum fallback.

        let tutoringPrompt, questionPrompt;

        if (contextText) {
            tutoringPrompt = `Act as an expert Grade ${grade} ${subject} Generative AI tutor specializing in the South African CAPS curriculum. Using the provided Grade ${grade} textbook content, generate comprehensive academic notes, a structured study guide, and at least 3 detailed worked examples/methodologies.
            If this is Mathematics, you MUST provide detailed, step-by-step equation derivations showing how to move from one step to the next.
            The tutorial should include:
            1. Core Concepts: Detailed definitions and academic principles exactly as presented for the Grade ${grade} level in this subject.
            2. Guided Methodology: A clear, step-by-step methodology for Grade ${grade} problem solving or subject analysis.
            3. Worked Examples: Provide 3 distinct, step-by-step worked examples or detailed case studies relevant to the topic.
            4. Practical Application: How this concept is applied in real-world Grade ${grade} scenarios.
            5. Answer Instructions: Guidance on how the learner should format their answers for the follow-up quiz.
            Return JSON: {"explanation": "string", "examples": "string", "formula": "LaTeX string or none", "answerInstructions": "string"}.
            Textbook Source Material: \n\n${contextText}`;

            questionPrompt = `Act as a generative AI assessor. Generate 3 rigorous assessment questions based on the topic "${topicName}" using the Grade ${grade} ${subject} textbook content provided. 
            Return a JSON object with a key "questions" containing an array of objects: [{"id": 1, "question": "string", "answer": "string", "explanation": "string"}].
            Context: \n\n${contextText}`;
        } else if (task || topicId) {
            // Fallback: Generate content using General Knowledge + Subject Context if no textbook or specific task object exists
            topicName = task ? task.topic : topicId;
            tutoringPrompt = `Act as an expert Grade ${grade} ${subject} generative AI tutor. Your goal is to help a student master the topic: "${topicName}".
            ${task ? `Base instructions: ${task.tutoringPrompt}` : ''}
            Requirements:
            1. Provide comprehensive, easy-to-understand Grade ${grade} level notes based on the South African CAPS curriculum.
            2. Include 3 distinct, step-by-step worked examples. For Mathematics, show the full logical derivation.
            3. Provide clear "answerInstructions" on how to format quiz answers (e.g., 'no spaces', 'digits only').
            Return JSON: {"explanation": "string", "examples": "string", "formula": "LaTeX string or none", "answerInstructions": "string"}`;
            questionPrompt = task ? task.questionPrompt : `Generate 3 rigorous assessment questions for Grade ${grade} ${subject} on the topic: "${topicName}". Return a JSON object with a key "questions" containing the array.`;
        } else {
            return res.status(404).json({ error: 'Topic or Textbook source not found.' });
        }

        const tutoringRaw = await aiTutor.safeAICall(tutoringPrompt, true);
        const tutoringData = typeof tutoringRaw === 'string' ? JSON.parse(tutoringRaw) : tutoringRaw;

        // Handle potential AI failures or empty responses
        const safeTutoring = {
            explanation: tutoringData?.explanation || "The AI tutor could not generate an explanation at this moment. Please try again or check the textbook.",
            examples: tutoringData?.examples || "",
            formula: tutoringData?.formula || "",
            answerInstructions: tutoringData?.answerInstructions || "Enter your answer clearly."
        };

        const questionsRaw = await aiTutor.safeAICall(questionPrompt, true);
        let questions = typeof questionsRaw === 'string' ? JSON.parse(questionsRaw) : questionsRaw;
        questions = Array.isArray(questions) ? questions : (questions.questions || questions.tasks || []);
        
        const assessmentId = `${req.user.id}-${Date.now()}`;
        aiTutor.activeAssessments.set(assessmentId, {
            userId: req.user.id,
            subject: subjectKey || subject,
            topicId,
            questionsWithAnswers: questions,
            startTime: Date.now(),
            timeLimit: 600
        });

        res.json({
            assessmentId,
            topic: topicName,
            explanation: safeTutoring.explanation,
            examples: safeTutoring.examples,
            answerInstructions: safeTutoring.answerInstructions,
            formula: safeTutoring.formula,
            isFromTextbook: !!contextText,
            questions: questions.map(({ answer, explanation, ...rest }) => rest),
            timeLimit: 600
        });
    } catch (error) {
        res.status(500).json({ error: 'AI Service failure: ' + error.message });
    }
};

exports.getAssignments = async (req, res) => {
    try {
        const learner = await db.query('SELECT id, grade, stream, subjects FROM children WHERE learner_user_id = $1', [req.user.id]);
        if (learner.rows.length === 0) return res.json([]);
        const { id: childId, grade, stream, subjects } = learner.rows[0];

        // Fetch assignments that match target criteria AND haven't been completed yet
        const result = await db.query(
            `SELECT a.* FROM announcements a
             WHERE a.role_target = 'learner' 
               AND a.is_assignment = TRUE 
               AND a.grade_target = $1 
               AND (a.stream_target = $2 OR a.stream_target = 'General') 
               AND (a.subject_target IS NULL OR a.subject_target = ANY($3::text[]))
               AND NOT EXISTS (
                   SELECT 1 FROM progress p 
                   WHERE p.child_id = $4 
                     AND p.notes LIKE 'Teacher Assignment: ' || a.title || '%'
               )`,
            [grade, stream, subjects, childId]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

/**
 * Allows learners to ask specific study questions to the AI
 */
exports.askAITutor = async (req, res) => {
    const { question, subject } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    try {
        const prompt = `You are a helpful academic assistant. A student is asking a question about ${subject || 'their studies'}: "${question}". Provide a clear, educational explanation suitable for a high school student.`;
        const answer = await aiTutor.getTextCompletion(prompt);
        res.json({ success: true, answer });
    } catch (err) {
        res.status(500).json({ error: 'AI Tutor is temporarily unavailable' });
    }
};

/**
 * Generates a summary for a specific topic to help with quick revision
 */
exports.summarizeTopic = async (req, res) => {
    const { topicContext } = req.body;
    try {
        const prompt = `Summarize the following academic content into bullet points for quick revision. Focus on key definitions and core concepts: \n\n${topicContext.substring(0, 5000)}`;
        const summary = await aiTutor.getTextCompletion(prompt);
        res.json({ success: true, summary });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate summary' });
    }
};

/**
 * Generates a personalized 4-week study plan for the learner
 */
exports.generateStudyPlan = async (req, res) => {
    const { subject } = req.query;
    try {
        const learnerRes = await db.query('SELECT grade FROM children WHERE learner_user_id = $1', [req.user.id]);
        if (learnerRes.rows.length === 0) return res.status(404).json({ error: 'Learner not found' });
        
        const grade = learnerRes.rows[0].grade;
        const prompt = `As an expert academic advisor, create a structured 4-week study plan for a Grade ${grade} student studying ${subject}. Include weekly goals, key areas of focus, and daily study durations.`;
        
        const plan = await aiTutor.getTextCompletion(prompt);
        res.json({ success: true, plan });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate study plan: ' + err.message });
    }
};

exports.gradeAITask = async (req, res) => {
    const { answers, assessmentId } = req.body;
    const client = await db.pool.connect();

    try {
const storedAssessment = aiTutor.activeAssessments.get(assessmentId);
        if (!storedAssessment || storedAssessment.userId !== req.user.id) {
            // Fallback: if the server restarted and the in-memory session is gone,
            // re-create the assessment grading context is not possible without the generated correct answers.
            // Return a clear error so the client can restart the lesson.
            return res.status(400).json({ error: 'Assessment session expired. Please restart the topic lesson and try again.' });
        }

        await client.query('BEGIN');

        const endTime = Date.now();
        const timeTakenSeconds = Math.floor((endTime - storedAssessment.startTime) / 1000);

        const { subject, topicId, questionsWithAnswers } = storedAssessment;
        const subjectKey = Object.keys(aiTutor.aiCurriculum).find(k => k.toLowerCase() === (subject || "").trim().toLowerCase()) || subject;
        const subjectData = aiTutor.aiCurriculum[subjectKey] || [];
        
        // Fix: If it's a textbook topic, topicId is the name. If curriculum, it's the ID.
        const taskDefinition = subjectData.find(t => t.id === topicId) || { topic: topicId };
        const topicDisplay = taskDefinition.topic;

        let totalQuestions = questionsWithAnswers.length;
        let correctCount = 0;
        let questionResults = [];

        questionsWithAnswers.forEach(q => {
            // AI sometimes nests the answer or uses different casing
            const correctAnswer = q.answer || q.Answer || q.correct_answer || "";
            
            const userAnsRaw = (answers[q.id] || "").toString().trim();
            const userAns = userAnsRaw.toLowerCase();
            const realAns = correctAnswer.toString().trim().toLowerCase();
            
            const isCorrect = userAns === realAns;
            if (isCorrect) correctCount++;

            questionResults.push({
                id: q.id,
                question: q.question,
                userAnswer: userAnsRaw,
                correctAnswer: correctAnswer, 
                explanation: q.explanation || "No explanation provided.",
                isCorrect
            });
        });

        const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
        const progressUpdate = percentage >= 80 
            ? `Mastery achieved in ${topicDisplay}. Ready for advanced modules.` 
            : percentage >= 50 
                ? `Good progress in ${topicDisplay}. Some reinforcement suggested.` 
                : `Developing understanding in ${topicDisplay}. Continued practice recommended.`;

        const childRes = await client.query('SELECT id FROM children WHERE learner_user_id = $1', [req.user.id]);
        if (childRes.rows.length === 0) throw new Error('Learner record not found.');
        const childId = childRes.rows[0].id;

        await client.query(
            `INSERT INTO progress (child_id, subject, term, grade, time_taken_seconds, notes, date) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [childId, subject, 'Term 1', percentage, timeTakenSeconds, `AI Auto-Assessment: ${topicDisplay} - ${progressUpdate}`]
        );

        await client.query('COMMIT');
        aiTutor.activeAssessments.delete(assessmentId);

        res.json({ 
            score: percentage, 
            grade: percentage,
            percentage: percentage, 
            aiInsight: progressUpdate,
            insight: progressUpdate,
            correct: correctCount, 
            total: totalQuestions,
            timeTaken: timeTakenSeconds,
            results: questionResults,
            feedback: percentage >= 50 ? "Well done! You have a solid grasp of this topic." : `Keep practicing.`
        });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
};

exports.gradeAssignment = async (req, res) => {
    const { answers, assessmentId: assignmentId } = req.body;
    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        // Fetch the assignment data using the transaction client
        const assignmentRes = await client.query('SELECT * FROM announcements WHERE id = $1 AND is_assignment = TRUE', [assignmentId]);
        if (assignmentRes.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });

        const assignment = assignmentRes.rows[0];
        const questionsWithAnswers = typeof assignment.assignment_data === 'string' 
            ? JSON.parse(assignment.assignment_data) 
            : assignment.assignment_data;

        let correctCount = 0;
        let questionResults = [];

        questionsWithAnswers.forEach(q => {
            const correctAnswer = (q.answer || "").toString().trim().toLowerCase();
            const userAnsRaw = (answers[q.id] || "").toString().trim();
            const userAns = userAnsRaw.toLowerCase();
            
            const isCorrect = userAns === correctAnswer;
            if (isCorrect) correctCount++;

            questionResults.push({
                id: q.id,
                question: q.question,
                userAnswer: userAnsRaw,
                correctAnswer: q.answer, 
                isCorrect
            });
        });

        const percentage = Math.round((correctCount / questionsWithAnswers.length) * 100);
        const progressUpdate = percentage >= 80 
            ? `Mastery achieved in ${assignment.title}. Ready for advanced modules.` 
            : percentage >= 50 
                ? `Good progress in ${assignment.title}. Some reinforcement suggested.` 
                : `Developing understanding in ${assignment.title}. Continued practice recommended.`;

        const childRes = await client.query('SELECT id FROM children WHERE learner_user_id = $1', [req.user.id]);
        const childId = childRes.rows[0].id;

        await client.query(
            `INSERT INTO progress (child_id, subject, term, grade, notes, date) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [childId, assignment.subject_target, 'Term 1', percentage, `Teacher Assignment: ${assignment.title} - ${progressUpdate}`]
        );

        await client.query('COMMIT');

        res.json({ 
            score: percentage, 
            results: questionResults,
            progressUpdate: progressUpdate,
            insight: progressUpdate,
            feedback: percentage >= 50 ? "Task submitted successfully." : "Task submitted. Review your corrections."
        });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
};

exports.getLeaderboard = async (req, res) => {
    const { subject } = req.query;
    try {
        const result = await db.query(
            `SELECT c.learner_number, MAX(p.grade) as top_score
             FROM progress p
             JOIN children c ON p.child_id = c.id
             WHERE LOWER(p.subject) = LOWER($1)
             GROUP BY c.learner_number
             ORDER BY top_score DESC
             LIMIT 10`,
            [subject]
        );
        const anonymized = result.rows.map(row => ({
            rank_id: row.learner_number.substring(0, 4) + "****",
            score: parseFloat(row.top_score)
        }));
        res.json(anonymized);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
