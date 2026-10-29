# Codeit

Codeit runs a local chat connected to the Codex app server. It uses your existing Codex authentication and the repository directory as its working directory.

## Start

1. Install Node.js 26.5 or later and npm 12.2.1 or later.
2. Install and authenticate the Codex CLI.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open http://127.0.0.1:9020 or http://localhost:9020 .

The API listens on port 9030. The API and web startup controls use ports 9031 and 9032. Run `npm run dev:api` and `npm run api:web` to start the services separately. Startup reports and stops listeners on the ports needed by the selected service. It requests graceful shutdown first, then terminates a verified listener if needed. A split start will not stop its sibling in an existing combined supervisor. Use combined startup to restart both in that case. Stop Codeit with Ctrl+C or `npm run stop`. The stop command stops both services started from this checkout.

Codeit reads the root `.env` file at startup. Copy `.env.example` to `.env` if needed. Existing environment variables take precedence. `CODEIT_DATA_DIR` selects the local data directory and defaults to `.codeit`. `CODEIT_WEB_PORT` and `CODEIT_API_PORT` must remain 9020 and 9030. Set an optional Gemini key only in the local `.env` or the server environment. Do not commit `.env`.

Codeit creates the `codeit-test` project and its `testing` chat on first start. Use the sidebar to create, select, and rename projects and chats. Choose Codex or Gemini before the first successful turn in a chat. A chat stays with that provider to preserve its conversation. Review Codex approval requests in the chat. Project names, chat history, and Codex thread IDs are stored locally in `.codeit/data.json`.

Run `npm run typecheck` and `npm run build` to check the project.

## Project work

Open project work from the sidebar. Enter an idea, a plan, acceptance criteria, and tasks. Approve the saved plan before starting a worker. Start a review after the worker finishes. Inspect its evidence and accept the task or send findings for another worker run. Each action requires your input. One worker or review runs at a time. Codeit stores this work in `.codeit/loops.json`. An interrupted run is marked for retry after restart.

The project folder is the Codex working directory. It is not a read-isolation boundary. Read-only mode limits writes but can still read files outside the folder. Codeit checks the effective Codex settings, but has not independently verified operating-system sandbox enforcement. Reviews use a separate read-only Codex thread. They are not independently verified.

## Chat inputs

Attach up to five UTF-8 text files or PNG, JPEG, GIF, and WebP images. Text files are limited to 1 MiB each. Images are limited to 5 MiB each. Use the file picker or drop files on the attachment area. Review file text before sending. Codex receives file text as a separate labeled text input and images as image inputs. The prompt stays unchanged. Codeit stores file text, image names, and OCR text in chat history. For Gemini, Codeit also stores image data locally to continue the conversation.

Choose Extract text (OCR) on an image to run English OCR with Tesseract.js. Review and edit the extracted text before sending. OCR downloads worker, core, and language files from external services and needs network access. It requires no API key. OCR can make mistakes.

Voice input uses the browser Web Speech API. Browser support varies. The browser may send audio to its speech service. Allow microphone access when prompted. Recognized text appears in the message for review before sending.

## Providers

Codex uses the installed Codex CLI and its existing authentication. Codeit lists models and reasoning levels from the local Codex app server. A listed model can still fail if the account cannot use it.

To use Gemini, set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in the server environment before starting Codeit. Codeit sends the key in a request header to the Gemini API. The browser does not receive the key. Gemini models come from the API model list. Google receives the prompt, attachments, and conversation context.

Gemini uses the Generate Content API for streamed text responses. It does not have Codeit workspace tools or Codex agent capabilities. Codeit uses the Gemini model default for reasoning and does not offer Gemini prompt refinement. Gemini conversations, including attached image data, are stored in `.codeit/data.json` for later turns.

Run `npx tsx --test tests/provider.test.ts` to check the Gemini integration with a mock service. A mock test does not verify Google account access.

Use the wand button to ask Codex to refine the current prompt. Review the result before sending. Refinement uses a separate temporary Codex thread and does not send a chat message. If you edit the draft while refinement runs, Codeit keeps your edits and offers the result separately.
