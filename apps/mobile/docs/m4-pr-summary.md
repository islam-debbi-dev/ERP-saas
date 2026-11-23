# Phase 39 · M4 Assistant IA: PR summary

Branch `phase-39-m4-assistant`, from `main` after M3b.

**No API change, no migration.** Nothing to run on Neon for this PR (`db:deploy` is not needed). **No new dependency**: `url_launcher` was already in `pubspec.yaml`, and dio streams the answer. The Markdown subset is parsed in plain Dart.

## What was built

The phase 30 assistant, in the app, for all four roles: seller, livreur, supervisor and storekeeper. It uses the API as it is: `apps/api/src/assistant/assistant.controllers.ts` and `packages/shared/src/schemas/assistant.ts`. It behaves like the web (`apps/web/src/lib/assistant.ts`, `components/assistant/`). One commit per step:

| Step | Commit | What |
|---|---|---|
| 1 | `feat(mobile): assistant entry in every role's Plus` | *Assistant* in the Plus menu of all four roles (seller and livreur are new; the supervisor's and storekeeper's placeholder is gone). It shows only when `GET /assistant/status` says `available: true`. The status is read once per signed-in user, and not at all without `AI_ASSISTANT`. The provider's name shows under the input, like the web. A deep link to `…/more/assistant` without the assistant goes back to Plus. |
| 2 | `feat(mobile): assistant SSE client` | `POST /assistant/chat` is SSE over POST, read with dio `ResponseType.stream`. A chunked UTF-8 decoder (so an Arabic letter cut between two network chunks stays whole) and a line splitter feed `data:` events into `AssistantStreamEvent` (`conversation`, `text`, `replace`, `tool`, `links`, `done`, `error`). A refusal before the stream (quota, daily limit, rate limit, no provider) arrives as a streamed JSON body; it is decoded into a normal `ApiError` and translated. |
| 3 | `feat(mobile): assistant chat screen and cubit` | `AssistantChatCubit` has the phases idle / streaming / done / error / cancelled. **Streaming:** the answer streams in, and a status line shows *Je réfléchis…*, or what the assistant is reading (*Je consulte le compte du client…*, all 7 tools translated). While it streams, **send gives way to a stop button**. **After it ends:** an error card has *Réessayer*, and a cut answer gets *Réponse tronquée*. **Layout and lifetime:** each role gets its own suggestions on the empty chat. The input sits above the keyboard and the safe area, and **leaving the screen cancels the request**. |
| 4 | `feat(mobile): assistant conversations and feedback` | **Historique**: the history icon lists `GET /assistant/conversations` (cursor, *Afficher plus*). A tap opens a conversation; delete asks first, and resets the chat if it was showing that conversation. **👍 / 👎** under each stored answer (`POST /assistant/messages/:id/feedback`). The choice shows at once; if the API did not save it, it is put back and a snackbar says so. |
| 5 | `feat(mobile): assistant links open app screens` | Each link becomes a chip that opens an app screen, or the dashboard in the browser (table in Decisions). Anything that is not a path of the web app never opens. |
| 6 | `feat(mobile): assistant answers in RTL with amounts LTR and a markdown subset` | A small Markdown subset with the app's text styles: paragraphs and line breaks, bullet and numbered lists, headings shown bold, `**bold**`, `` `code` ``, and `[label](href)` (label only). The direction comes from the first strong letter, so an Arabic answer is RTL even in the French app. **Amounts and dates are isolated LTR:** `1 234 567,89 DA` and `2026-11-20` keep their order inside Arabic (checked on a rendered screenshot, not only by tests). |
| — | `docs(mobile): M4 assistant summary` | This file and the ROADMAP row. |

### Rules applied
- **Data scope stays on the server.**
  - The app sends only `{ conversationId?, message }`. It never filters or adds data to the prompt.
  - The API's tools answer in the user's scope; a seller never gets another seller's client.
  - Link targets are screens the role already reaches from its own menus. The API scopes what those screens show.
- **Errors are translated.** All the codes the assistant can meet are translated in ar / fr / en: `AI_QUOTA_EXCEEDED` (with *Elles reviennent le {date}* from `details.resetDate`), `AI_DAILY_LIMIT`, `AI_RATE_LIMITED`, `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`, `TOO_MANY_REQUESTS`, and the new `AI_INVALID_KEY` and `AI_MODEL_NOT_FOUND`. A cut stream has its own message.
- **Strings**: ar, fr and en with identical keys (the parity test is green). That covers the 7 tool names, 3 providers and 12 role suggestions. `assistant.soon_*` is gone with the placeholder screen.
- **Sub-page**: the chat and the history hide the bottom bar by themselves (#85).

## How to test

### Local checks
- **App** (`apps/mobile`): `flutter analyze` (no issues) and `flutter test` (424 tests, 80 new).
- **Unit tests:**
  - SSE parser: an event split over two chunks, an Arabic letter cut between chunks, several events in one chunk, `replace`, `error`, CRLF / comments / unknown types, a stream cut in the middle.
  - Repository: a JSON refusal before the stream, a connection lost mid-answer, offline.
  - Cubit: idle → streaming → done, replace, refusal + retry, error with or without text, stop (with and without text), cut (end without `done`, or error) + retry, close cancels, reset, open, feedback and its revert.
  - Links: the whole table per role, no dashboard, outside links.
  - Markdown: the parser, and the web's `splitAmounts` cases.
- **Widget tests** at 360 × 640 in `ar` and `fr` with the overflow check:
  - the Plus menu of each role, with and without the assistant;
  - the empty chat;
  - streaming with a tool, then done and truncated;
  - the quota error with its date;
  - the input with the keyboard open;
  - the history (list + load more, empty, error);
  - open, rate and delete;
  - the link chips;
  - an Arabic and a French answer.
- **Router test:** a link to a client from the chat goes to the Clients tab, and the Plus tab still holds the chat.
- **Root** (Node 22, a fresh Postgres 16 on port 5434): `pnpm lint && pnpm typecheck && pnpm test`. Results are in **Check results** below.

### Setup for the manual checks
1. **API:** run it locally or use a preview with an AI provider configured: the platform key, or the company's own key in *Paramètres → Assistant IA*. Point `apps/mobile/.env` `API_BASE_URL` at it, set `DASHBOARD_URL` to the web app, and `flutter run` on an Android phone.
2. **Demo tenant** (DISTRIBUTION with `AI_ASSISTANT`): one user per role.
   - **The seller:** two sellers, each with his own clients. Seller A's client "Superette El Baraka" owes money.
   - **The others:** a livreur with a confirmed order, a supervisor of seller A, and a storekeeper.
3. **Phone:** 360 dp. Run each check once in **ar** and once in **fr** (Plus → language).

### M4 acceptance checks
1. **The entry**: each role → *Plus*. Expected: *Assistant* is there.
   - On the web, switch the assistant off: no provider, or the company key disabled. Log out and in on the phone. Expected: no *Assistant* in Plus. Turn it back on.
2. **A how-to question in darja, for each role**:
   - seller: «كيفاش ندير بيعة مباشرة من الكاميون؟»
   - livreur: «كيفاش نسلم طلبية؟»
   - supervisor: «كيفاش نسكر صندوق تاع بياع؟»
   - storekeeper: «كيفاش ندير جرد؟»

   Expected:
   - the answer **streams** in, word by word;
   - Arabic text is right to left;
   - lists show bullets or numbers;
   - the provider's name shows under the input.
3. **A data question, for each role**: «شحال الكريدي تاع الكليان Superette El Baraka؟».
   - Expected: *نقرا حساب الزبون…* while it reads, then the amount as `1 234,50 DA` in order inside the Arabic sentence.
   - **Seller B** asks the same about seller A's client. Expected: the assistant does not find him or does not give his balance (the API's scope).
   - The livreur, supervisor and storekeeper get what their web account would see.
4. **Stop**: ask a long question («اشرح لي كيفاش تخدم الجولة بالتفصيل») and tap ■ while it writes. Expected: it stops, the text written so far stays, and *Envoyer* comes back.
5. **Links**: after the client answer, tap the client's chip.
   - Seller / livreur: the client's screen opens in *Clients*, and the Plus tab still holds the chat.
   - Supervisor / storekeeper: the dashboard's client page opens in the browser.
   - From a seller's answer about a BL number (*«واش حالة BL-2026-…؟»*), the chip opens the sale's detail; Back returns to the chat.
6. **The quota error**: on a local or preview database (SaaS mode, the platform's key), lower the company plan's `aiQuestionsPerMonth` (table `Plan`) to the number of questions asked this month, then ask a question. Put the value back after. Expected: *Votre société a utilisé ses questions de ce mois. Elles reviennent le 01/12/2026.* (translated in ar), and the question back in the box.
7. **History and feedback**:
   - The history icon lists the conversations; open one.
   - 👍 on an answer. Expected: on the web (super-admin usage), the answer is counted useful.
   - Delete a conversation (confirm). Expected: it is gone from the phone and the web.
8. **Leaving cancels**: ask, then press Back at once. Expected: no crash; reopening shows a new chat.
9. **Airplane mode** during an answer. Expected: *La connexion a été coupée…* with *Réessayer*; with the network back, *Réessayer* asks again.

## Decisions
- **Links:**

  | Web path | Seller | Livreur | Supervisor / storekeeper |
  |---|---|---|---|
  | `/clients/:id` | Clients tab → client | Clients tab → client | dashboard |
  | `/ventes/:id` | sale detail (as *Mes ventes*) | sale detail (as *Mes livraisons*) | dashboard |
  | `/commandes/:id` | order detail (with TOURNEES, as *Mes commandes*) | the delivery screen | dashboard |
  | `/versements` | *Mes versements* (with PAYMENTS_CREATE) | *Mes versements* (if granted) | dashboard |
  | anything else (`/stock/…`, `/rapports`, `/achats/…`, `/clients/a-relancer`, help pages) | dashboard | dashboard | dashboard |

  - "dashboard" means `DASHBOARD_URL + href` in the external browser. With no `DASHBOARD_URL`, those chips are hidden.
  - An id must be a UUID, so `/clients/nouveau` is never taken for a client.
- **A link into another tab switches tab (`go`); it is not pushed over the chat.**
  - go_router loses the location when a route pushed across shell branches is popped (tested: the URL fell back to `/seller/more` while the chat still showed).
  - The Plus tab keeps the chat as it was, so tapping *Plus* brings it back.
  - Sale and order details open over the chat (`Navigator.push`, as the lists do), so Back returns to it.
- **In-text links show their label only** (underlined). The API already offers them as chips (`answerLinks` takes the links quoted in the text).
- **Tool lines are the web's sentences** (*Je consulte le compte du client…*), one per tool. An unknown tool shows *Je réfléchis…*.
- **A cut stream** (connection lost, or an end without `done`) is an error you can retry. Any partial answer stays.
  - The API keeps a question whose client left, so the question bubble stays too. Retry does not show it twice.
  - A refusal or an error with nothing written removes both bubbles and puts the question back in the box. A new conversation is then forgotten, like on the web: the API forgot it too.
- **Stop keeps what was written**, and the API keeps the question. Like the web.
- **The status is read once per signed-in user**, and again when the user or his `AI_ASSISTANT` flag changes. A failed read hides the entry until the next sign-in or app start: the phone never guesses `available`.
- **Delete asks for a confirm** (the web does not): a tap is easy on a phone.
- **Feedback is put back if the API did not save it** (the web ignores the failure), with a snackbar.
- **Dates are isolated LTR too**, not only amounts. `2026-11-20` rendered as `20-11-2026` in Arabic on the screenshot. The web has the same gap (see Parked ideas).
- **History is a page pushed from the chat**, not a go_router route: it only returns which conversation to open and which were deleted.

## Parked ideas
- **Web: isolate dates in answers too** (`split-amounts.ts`), as the phone now does: `2026-11-20` flips to `20-11-2026` in Arabic.
- **API: a `/versements/:id` web route**, or the payment id in `find_document`'s link. Today a versement link opens the list.
- **A "mobile" hint in the assistant's system prompt** (already parked in the phase prompt), so how-to answers name the app's screens rather than the web's.
- **Tappable in-text links**: they are chips today.
- **Golden image tests in Arabic**, as noted in M2, M3 and M3b. Here I checked the Arabic answer on a screenshot rendered with the Almarai font.

## Not done here (needs you)
- **Real-phone checks**: written above for you to run in `ar` and `fr`. I could not run them on a real Android phone or against a real AI provider.
- **No APK build** (`flutter build apk` skipped as asked, to save disk). There is no mobile CI job (PR #82).

## What is left of phase 39
With M4, every sub-phase of this phase is built: M0, M1, M2, M3, M3b and M4. M5 (offline) is a later phase, by your choice. What remains is the definition of done:
- **Real-phone acceptance runs** of M1–M4 in `ar` and `fr` at 360 dp, written in each PR, and an APK installed on a real Android phone. There is no mobile CI job to build it, so it is a local `flutter build apk` on a machine with disk room.
- **Your Debvora assets**: the final colours (one `APP_PRIMARY_COLOR` / `APP_SECONDARY_COLOR` edit) and the logo / launcher icons.
- **Store release**: the new upload keystore made on your Mac (`apps/mobile/docs/play-store-release.md`), then the Play Store listing.
- **Parked across the sub-phases**:
  - golden tests in Arabic;
  - API: team scoping of `/orders/deliverers`;
  - API: a status filter on `/stock-transfers`;
  - API: hide `expectedQtyBase` for blind counts;
  - Bluetooth printing, push notifications, the Dart package rename, iOS.
- **Phase 39 row in ROADMAP**: mark it done once those runs pass.

## Check results (local, 2026-11-23, branch head)
| Check | Result |
|---|---|
| `flutter analyze` (apps/mobile) | ✅ no issues |
| `flutter test` (apps/mobile) | ✅ 424 tests |
| `pnpm lint` (Node 22.23.5) | ✅ |
| `pnpm typecheck` | ✅ (no TypeScript changed in this branch) |
| `pnpm test` (fresh Postgres 16 on port 5434, `--force`) | ✅ shared 41 files, web 13 files, API 74 / 74 suites (994 / 994 tests), no timeout and no rerun needed |
