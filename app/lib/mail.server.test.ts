import { afterEach, describe, expect, it } from "vitest";

import { defaultInvitationMessage, defaultInvitationSubject } from "./invitation-email";
import { capturedAuthEmails, clearCapturedEmails, invitationEmailContent, sendAuthEmail, sendInvitationEmail } from "./mail.server";
import { registrationDisclosure } from "./registration-disclosure";

afterEach(() => {
  clearCapturedEmails();
});

describe("captured auth mail", () => {
  it("captures localized verification messages without sending them", async () => {
    const previous = process.env.EMAIL_DELIVERY;
    delete process.env.EMAIL_DELIVERY;
    try {
      await sendAuthEmail({
        to: "tester@example.com",
        url: "https://example.test/api/auth/verify-email?token=test",
        kind: "verification",
        language: "en",
      });
      expect(capturedAuthEmails()[0]).toMatchObject({
        to: "tester@example.com",
        subject: "Verify your Easy Quote email",
      });
    } finally {
      if (previous === undefined) delete process.env.EMAIL_DELIVERY;
      else process.env.EMAIL_DELIVERY = previous;
    }
  });
});

describe("invitation email", () => {
  const url = "https://example.test/sign-up?invitation=abc&x=1";

  it("delivers the subject and message the Administrator wrote, with every {lien} replaced by the link", async () => {
    await sendInvitationEmail({ to: "invitee@example.com", url, subject: "Bienvenue", message: "Bonjour,\n\nVotre lien : {lien}\nEncore : {lien}" });

    expect(capturedAuthEmails()).toEqual([{
      to: "invitee@example.com",
      subject: "Bienvenue",
      text: `Bonjour,\n\nVotre lien : ${url}\nEncore : ${url}`,
      html: `<p>Bonjour,</p><p>Votre lien : <a href="${url.replace("&", "&amp;")}">${url.replace("&", "&amp;")}</a><br>Encore : <a href="${url.replace("&", "&amp;")}">${url.replace("&", "&amp;")}</a></p>`,
    }]);
  });

  it("adds the link at the end of a message without {lien}", () => {
    const content = invitationEmailContent({ url, subject: "S", message: "Come and try it." });

    expect(content.text).toBe(`Come and try it.\n\n${url}`);
    expect(content.html).toBe(`<p>Come and try it.</p><p><a href="${url.replace("&", "&amp;")}">${url.replace("&", "&amp;")}</a></p>`);
  });

  it("escapes the message in the HTML email and turns --- lines into rules", () => {
    const content = invitationEmailContent({ url, subject: "S", message: "<script>alert('x')</script> & co\n\n---\n\n\"Hi\" {lien}" });

    expect(content.html).not.toContain("<script>");
    expect(content.html).toBe(`<p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co</p><hr><p>&quot;Hi&quot; <a href="${url.replace("&", "&amp;")}">${url.replace("&", "&amp;")}</a></p>`);
    expect(content.text).toContain("<script>alert('x')</script>");
  });

  it("has a default text in French then English, with the link in each part and without the data disclosure", () => {
    for (const administrator of [false, true]) {
      const message = defaultInvitationMessage(administrator);
      const [french, english] = message.split("\n\n---\n\n");
      expect(french).toContain("Ouvrez ce lien pour créer votre compte et choisir votre mot de passe :\n{lien}");
      expect(french).toContain("valable 7 jours");
      expect(english).toContain("Open this link to create your account and choose your password:\n{lien}");
      expect(english).toContain("valid for 7 days");
      expect(message).not.toContain(registrationDisclosure.fr);
      expect(message).not.toContain(registrationDisclosure.en);
      expect(message).not.toMatch(/30 (jours|days)/);
    }
    expect(defaultInvitationMessage(true)).toContain("Vous êtes invité à utiliser Easy Quote en tant qu’administrateur.");
    expect(defaultInvitationMessage(true)).toContain("You are invited to use Easy Quote as an Administrator.");
    expect(defaultInvitationMessage(false)).not.toMatch(/administrat/i);
    expect(defaultInvitationSubject).toBe("Invitation à Easy Quote / Your invitation to Easy Quote");

    const html = invitationEmailContent({ url, subject: defaultInvitationSubject, message: defaultInvitationMessage(false) }).html;
    expect(html.match(/<a href=/g)).toHaveLength(2);
    expect(html).toContain("<hr>");
    expect(html).toContain("<p>Ouvrez ce lien pour créer votre compte et choisir votre mot de passe :<br><a href=");
  });
});
