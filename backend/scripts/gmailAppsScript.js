const SHARED_SECRET = 'CHANGE_THIS_SECRET';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.secret !== SHARED_SECRET) {
      return json({ success: false, error: 'Unauthorized' });
    }

    if (!body.to || !body.subject || !body.html) {
      return json({ success: false, error: 'Missing to, subject, or html' });
    }

    GmailApp.sendEmail(body.to, body.subject, 'ONCHYRA verification email', {
      htmlBody: body.html,
      name: 'ONCHYRA Verify'
    });

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: err.message });
  }
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
