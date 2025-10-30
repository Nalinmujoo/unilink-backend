import nodemailer from 'nodemailer';

// Create a "transporter"
// We're using a test account from Ethereal.email
// This will NOT send a real email. It will log it to the console.
let transporter: nodemailer.Transporter;

async function createTestTransporter() {
  if (transporter) {
    return transporter;
  }

  // Create a test account
  const testAccount = await nodemailer.createTestAccount();

  // Create a transporter object using the test account
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass, // generated ethereal password
    },
  });

  return transporter;
}

/**
 * Sends a verification email with an OTP.
 * In development, this logs a link to the console.
 * @param userEmail - The email address to send to.
 * @param otp - The one-time password.
 */
export async function sendVerificationEmail(userEmail: string, otp: string) {
  const mailTransporter = await createTestTransporter();

  const info = await mailTransporter.sendMail({
    from: '"UniLink" <noreply@unilink.app>', // sender address
    to: userEmail, // list of receivers
    subject: 'Your UniLink Verification Code', // Subject line
    text: `Your verification code is: ${otp}`, // plain text body
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Welcome to UniLink!</h2>
        <p>Your one-time verification code is:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">
          ${otp}
        </p>
        <p>This code will expire in 10 minutes.</p>
      </div>
    `, // html body
  });

  console.log('Message sent: %s', info.messageId);
  // Log the "preview" link to the console
  console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
}