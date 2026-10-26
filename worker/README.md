# Workday Messages

The small online service behind the Messages tab in Workday. It runs free on Cloudflare Workers.

- Receives WhatsApp Business messages from Meta (webhook at `/webhook`) and keeps them.
- The Workday app lists chats, reads messages, and sends text and photos through it.
- Sends a phone notification when a message comes in (the notification itself carries no message text; the phone asks the service).
- Test mode until WhatsApp is connected: messages are saved but not sent.

No keys live in this code. The app key, webhook verify token and notification keys are made on first use and kept in the service's own storage. The WhatsApp token is entered from Workday (Settings, Messages).

Deploys automatically from GitHub (`.github/workflows/deploy-messages.yml`) once the repository has two secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
