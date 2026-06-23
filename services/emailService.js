const nodemailer = require('nodemailer');

// Configure the transporter with your Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const emailService = {
  /**
   * Real email sender using Nodemailer.
   */
  send: async (to, subject, body) => {
    const mailOptions = {
      from: `"Fusion High Admin" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: body,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EMAIL] Sent to ${to}: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('[EMAIL ERROR] Failed to send email:', error);
      return false;
    }
  },

  templates: {
    registrationSuccess: (name) => ({
      subject: 'Welcome to Fusion High - Registration Successful',
      body: `Hello ${name || 'User'},\n\nWelcome to Fusion High! Your account has been successfully created. You can now log in to the portal using your credentials.\n\nRegards,\nFusion High Admin`
    }),
    forgotPassword: (otp) => ({
      subject: `Password Reset Verification Code: ${otp}`,
      body: `Hello,\n\nYour verification code for password reset is: ${otp}\n\nThis code is valid for 15 minutes. If you did not request this, please secure your account.\n\nRegards,\nFusion High Admin`
    }),
    passwordResetSuccess: () => ({
      subject: 'Security Alert: Password Changed',
      body: 'Your password for Fusion High has been successfully updated. If you did not perform this action, please contact administration immediately.'
    }),
    learnerAdmission: (name, surname, learnerId, grade, setupCode, registrarRole) => ({
      subject: `Admission Confirmed: ${name} ${surname} (ID: ${learnerId})`,
      body: `Hello,\n\nThe registration for ${name} ${surname} has been processed successfully by their ${registrarRole}.\n\nLearner Account Setup:\n- Learner Number: ${learnerId}\n- One-time Setup Code: ${setupCode}\n\nFull Registration Details:\n- Name: ${name} ${surname}\n- Grade: ${grade}\n\nThe learner must use the Forgot Password / Setup page, enter their learner number, verify this setup code, and choose their own password. This code expires in 7 days.\n\nRegards,\nFusion High Admin`
    }),
    newAssignment: (learnerName, subject, title) => ({
      subject: `New Assignment: ${subject} - ${title}`,
      body: `Hello ${learnerName},\n\nA new assignment has been posted for ${subject}: "${title}".\n\nPlease log in to your dashboard to complete this task.\n\nRegards,\nFusion High Admin`
    })
  }
};

module.exports = emailService;
