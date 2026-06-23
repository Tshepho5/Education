import React, { useState, useEffect } from 'react';
import axios from 'axios';

const LearnerHome = () => {
    const [pendingTasks, setPendingTasks] = useState([]);
    const [submittedTasks, setSubmittedTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchTasks = async () => {
        try {
            const response = await axios.get('/api/tasks/dashboard');
            const allTasks = response.data;

            // Automatically separate tasks based on the backend flag
            setPendingTasks(allTasks.filter(task => !task.is_submitted));
            setSubmittedTasks(allTasks.filter(task => task.is_submitted));
        } catch (error) {
            console.error("Error loading tasks", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const handleAttempt = async (taskId) => {
        try {
            // Simulate task submission for now to demonstrate the task moving to 'Submitted'
            await axios.post('/api/tasks/submit', { taskId, content: "Task attempted successfully" });
            fetchTasks(); // Refresh list to move task automatically
        } catch (error) {
            alert("Failed to submit task. Please try again.");
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="dashboard-container">
            <h1>My Dashboard</h1>

            <section className="task-section">
                <h2>Pending Tasks</h2>
                {pendingTasks.length > 0 ? (
                    pendingTasks.map(task => (
                        <div key={task.id} className="task-card pending">
                            <h3>{task.title}</h3>
                            <p>Due: {new Date(task.due_date).toLocaleDateString()}</p>
                            <button onClick={() => handleAttempt(task.id)}>Attempt Task</button>
                        </div>
                    ))
                ) : <p>No pending tasks! You are all caught up.</p>}
            </section>

            <section className="task-section">
                <h2>Tasks Completed ({submittedTasks.length})</h2>
                {submittedTasks.length > 0 ? (
                    submittedTasks.map(task => (
                        <div key={task.id} className="task-card completed">
                            <h3>{task.title}</h3>
                            <span className="status-badge">Completed</span>
                        </div>
                    ))
                ) : <p>No tasks submitted yet.</p>}
            </section>
        </div>
    );
};

export default LearnerHome;