# Infomaniak SMTP for Better Auth email

Checked 2026-09-09 against public Infomaniak documentation. No account, secret, service, or app configuration was accessed or changed.

## Verdict

An existing Infomaniak Mail Service or kSuite mailbox can send a small app's verification and password-reset mail through authenticated SMTP. Infomaniak explicitly recommends authenticated SMTP for messages sent by applications and shows it for website contact forms. [Authenticated application email](https://www.infomaniak.com/en/support/faq/2023/use-authenticated-email-sending-from-a-website)

A VPS alone is not evidence of that entitlement. The SMTP login is a full email address and its mail password. Infomaniak says an address is created within a Mail Service and that a custom-domain address needs a Mail Service for that domain. A VPS subscription does not appear in those prerequisites. [Mail Service requirement](https://www.infomaniak.com/en/support/faq/1944/order-email-addresses-from-infomaniak)

## SMTP settings

| Setting | Value |
| --- | --- |
| Host | `mail.infomaniak.com` |
| Preferred submission | Port `587`, STARTTLS |
| Alternative | Port `465`, implicit SSL/TLS |
| Authentication | Required. Username is the full sender email address. |
| Password | A per-address mail or device password. SMTP supports `LOGIN` and `PLAIN`. |

Infomaniak calls port 587 with STARTTLS the standard client submission choice. Its API does not provide an email-send endpoint, so SMTP is the integration path. [Ports and protocols](https://www.infomaniak.com/en/support/faq/468/understanding-mail-server-ports-and-protocols)

Use a separate device password for the app, not an Infomaniak account password. Infomaniak supports distinct passwords for devices and software such as a CRM, and lets an administrator revoke one without affecting other access. [Device passwords](https://www.infomaniak.com/en/support/faq/1344/manage-users-passwords-for-an-email-address)

## Service boundaries and limits

- Mail Service Starter permits 200 outgoing recipient deliveries per rolling 24 hours. Mail Service Premium permits 500. kSuite plans shown in the same table range from 200 to 500. A message addressed to several recipients consumes one quota unit per recipient. Limits are not reset at midnight. [Outgoing limits](https://www.infomaniak.com/en/support/faq/2065/understanding-the-limits-on-outgoing-emails-per-24-hours)
- Any one message is limited to 100 total To, CC, and BCC recipients. [Recipient limit](https://www.infomaniak.com/en/support/faq/580/understanding-the-limits-on-the-number-of-recipients-per-email)
- Infomaniak treats large-recipient mail as a Newsletter use case. Its published rule permits a justified, authenticated written request to modify the security rules for a specific paid email address. That is a limit-management option, not a promise that an app can send arbitrary volume. [Outgoing limits](https://www.infomaniak.com/en/support/faq/2065/understanding-the-limits-on-outgoing-emails-per-24-hours)
- The public docs support authenticated app SMTP. I found no public rule that bans low-volume automated verification or reset messages. They still remain subject to the mailbox plan's anti-abuse limits and normal deliverability checks.

For VPS networking, outgoing port 25 is blocked by default. Cloud VPS customers can ask support to open it with justification. VPS Lite cannot open it. This does not block the recommended authenticated submission route on port 587. [VPS firewall](https://www.infomaniak.com/en/support/faq/2822/manage-the-cloud-vps-vps-lite-firewall)

## Sender and domain setup

The sender should be an actual address hosted by the Mail Service, such as `auth@example.com`, with a generated device password. Infomaniak's application guide also warns that the configured app sender must match the SMTP address to avoid sender-mismatch errors. [Authenticated application email](https://www.infomaniak.com/en/support/faq/2023/use-authenticated-email-sending-from-a-website)

Configure and check SPF, DKIM, and DMARC for the sender domain. Infomaniak's Mail Service has a Global Security check for them. SPF authorizes sending servers and DKIM signs sent mail. DMARC checks alignment with the visible sender domain through SPF or DKIM. If the domain's DNS is managed elsewhere, its owner must publish the required records there. [SPF, DKIM, and DMARC](https://www.infomaniak.com/en/support/faq/2692/automatically-check-spfdkimdmarc)

## Transactional product

Infomaniak's application-email documentation calls Mail Service the "dedicated service" for authenticated application SMTP. [Unauthenticated app mail](https://www.infomaniak.com/en/support/faq/2150/use-unauthenticated-not-recommended-email-sending-from-a-website) Its separately named high-volume email product is the [Newsletter tool](https://www.infomaniak.com/en/marketing-events/newsletter-tool), which is for newsletter campaigns.

I did not find a separately branded Infomaniak transactional-email or SMTP-relay product in the public product pages and support search checked on this date. That is a research result, not proof that no sales-only or future offering exists.

## Practical recommendation for selected testers

First establish entitlement without assuming it: check whether the Infomaniak organization already has Mail Service or kSuite with a mailbox on the intended sender domain. If it does, authenticated SMTP on port 587 with a dedicated `auth@` mailbox and device password is a sensible, low-cost path for a selected tester group. The documented 200 or 500 daily recipient limits leave ample room for modest signup and reset traffic, but monitor sends and bounces.

If the organization has only a VPS, choose or buy an email service before implementation. Do not self-host an SMTP server merely because the app runs on a VPS. The VPS port-25 restriction and the missing mailbox credentials make that the wrong default here. Resend was not assumed or selected by this research.

## Uncertainty

The user's paid services are unspecified. Nothing reviewed here shows that they own a Mail Service, kSuite plan, mailbox, sender domain, or the right to create a device password. The exact daily allowance depends on the actual mailbox plan. Confirm those facts in the account before choosing the provider.
