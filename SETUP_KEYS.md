# MachineGuard manual credential and deployment setup

This repository contains **no connected database, cloud account, API key, deployment, project ID or private credential**. Every external resource must be created manually in your own account.

Do not send secrets in chat and do not commit `.env` files. The repository ignores `.env` automatically.

## 1. Create the three environment files

Run from the project root in PowerShell:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
Copy-Item ai-service/.env.example ai-service/.env
```

The files have different security levels:

```text
server/.env       Private Express and database secrets
client/.env       Public browser build configuration
ai-service/.env   Private LLM key
```

Never place `MONGODB_URI`, `JWT_SECRET` or `LLM_API_KEY` inside `client/.env`. Vite variables beginning with `VITE_` are included in the browser build.

## 2. Create your MongoDB Atlas database

The project needs this value:

```env
MONGODB_URI=mongodb+srv://YOUR_DATABASE_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/maintai?retryWrites=true&w=majority
```

There is no â€œMongoose ID.â€ Mongoose is the Node.js library. MongoDB Atlas supplies the connection string.

### Create a project and cluster

1. Visit `https://cloud.mongodb.com` and sign in to your account.
2. Select **New Project**.
3. Enter `MachineGuard` and finish project creation.
4. Select **Build a Database** or **Create** under Database Deployments.
5. Choose an M0/free option if available.
6. Choose a nearby region, name the cluster `machineguard-cluster`, and create it.

### Create a database user

1. Open **Security â†’ Database Access**.
2. Select **Add New Database User**.
3. Choose password authentication.
4. Use an application username such as `maintai_app`, not your email.
5. Generate and save a strong password.
6. Give the account read/write access to the application database where the UI permits it. Avoid Atlas-administrator permissions.
7. Create the user.

Your Atlas login and database user are different. The Express backend connects using the database user.

### Add network access

1. Open **Security â†’ Network Access**.
2. Select **Add IP Address**.
3. For local development, select **Add Current IP Address**.
4. Add the note `Chaitanya development computer`.
5. Confirm and wait until the entry becomes active.

Atlas accepts database connections only from addresses on the project IP access list. See the [official MongoDB connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

### Retrieve the connection string

1. Open **Database â†’ Database Deployments**.
2. Select **Connect** beside your cluster.
3. Select **Drivers** or **Connect your application**.
4. Choose **Node.js** and the current recommended driver version.
5. Copy the displayed `mongodb+srv://...` value.
6. Replace `<password>` with the database-user password.
7. Add `/maintai` before the query string if the URI has no database name.
8. URL-encode any special characters in the password. MongoDB notes that reserved characters must be escaped.
9. Paste the completed value into `server/.env`:

```env
MONGODB_URI=PASTE_YOUR_COMPLETE_URI_HERE
```

Do not place it in `client/.env`, GitHub, documentation or screenshots.

## 3. Generate your JWT secret

This secret is created by you. It does not come from MongoDB or Firebase.

Run:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the output into `server/.env`:

```env
JWT_SECRET=PASTE_THE_GENERATED_RANDOM_VALUE_HERE
```

For local development, keep:

```env
PORT=5000
CLIENT_URL=http://localhost:5173
AI_SERVICE_URL=http://localhost:8000
SENSOR_INTERVAL_MS=4000
```

## 4. Create an optional LLM API key

This key is **optional**. Without it the AI copilot still answers using local evidence
retrieval; the key only upgrades those answers to LLM-written explanations.

The service accepts any OpenAI-compatible provider. Google Gemini is the default because its
free tier needs no payment card.

### Option A â€” Google Gemini (recommended, free)

1. Visit `https://aistudio.google.com` and sign in with your Google account.
2. Select **Get API key**.
3. Select **Create API key** and copy the value.
4. Check which model is currently offered and note its exact name.
5. Paste into `ai-service/.env`:

```env
LLM_API_KEY=PASTE_YOUR_GEMINI_KEY_HERE
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-3.8-flash
```

Set `LLM_MODEL` to the model name you noted in step 4. Model names change over time, so
confirm it rather than trusting the default above.

### Option B â€” Groq (free, no card)

```env
LLM_API_KEY=PASTE_YOUR_GROQ_KEY_HERE
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=CONFIRM_IN_GROQ_CONSOLE
```

### Option C â€” OpenAI (paid)

Leave `LLM_BASE_URL` empty and set `LLM_MODEL` to an OpenAI model name.

Restart FastAPI after changing this file. `GET /health` reports `"llmEnabled": true` once a
key is loaded, and `/ask` returns `"mode": "hosted-llm"` instead of `"local-evidence"`.

If the key is wrong or out of quota, the service logs the reason and falls back to local
answers with `"mode": "local-evidence-fallback"` rather than failing the request.

## 5. Create the Python environment

Use **Python 3.11**, which is what the pinned versions in `requirements.txt` target. The
scientific packages do not all ship wheels for newer versions,
and a mismatched interpreter produces confusing import errors rather than a clear failure.

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

`npm run dev` locates this virtualenv automatically, so it does not need activating first.

## 6. Train the bearing model

The repository ships the trained model (`ai-service/models/`) and the replay bundle
(`ai-service/data/replay/`), so **this section is only needed to retrain from scratch.**

The raw dataset is ~134 MB and is deliberately not committed.

```powershell
.venv\Scripts\python.exe ai-service\training\download.py        # fetch 40 CWRU recordings
.venv\Scripts\python.exe ai-service\training\train.py           # train + evaluate
.venv\Scripts\python.exe ai-service\training\export_replay.py   # build the replay bundle
```

Training prints three evaluation protocols. Quote the **leave-one-load-out** figure; the
random-split figure is leaky by construction and is printed only for contrast. Documented
limitations are written into `ai-service/models/metadata.json` and served at `GET /model`.

Changing `ai-service/preprocessing.py` changes the feature set, so bump `MODEL_INPUT_VERSION`
and retrain. The service refuses to load a model built against a different version rather than
serving confident nonsense.

## 7. Test everything locally

From the project root:

```powershell
npm run dev
```

Open:

```text
Frontend: http://localhost:5173
Express:  http://localhost:5000/api/health
FastAPI:  http://localhost:8000/health
Model:    http://localhost:8000/model
AI docs:  http://localhost:8000/docs
```

Expected signs that everything is wired up:

- Express prints `MongoDB connected` with a valid Atlas URI.
- FastAPI logs `[model] Loaded bearing_rf_v1` and `[replay] Loaded 5 scenarios`.
- FastAPI health shows `"llmEnabled": true` once an LLM key is loaded.
- The **Fault replay** page plays recorded windows and shows predictions against ground truth.

Run the test suites with:

```powershell
npm run test --prefix server
.venv\Scripts\python.exe -m pytest ai-service -q
```

## 8. Create your GitHub repository manually

1. Visit `https://github.com/new` while signed in.
2. Set the repository name to `machineguard-ops`.
3. Choose Public for a portfolio repository only after confirming no secrets are staged.
4. Do not initialize it with another README, `.gitignore` or licence.
5. Create the repository.
6. In the local project root, run:

```powershell
git init
git add .
git status
```

7. Confirm that `server/.env`, `client/.env` and `ai-service/.env` are absent from staged files.
8. Continue:

```powershell
git commit -m "Build MachineGuard industrial intelligence platform"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/machineguard-ops.git
git push -u origin main
```

Replace `YOUR_USERNAME`. The ZIP contains no configured repository or remote.

## 9. Deploy FastAPI manually on Render

Create the AI service before Express because Express needs its URL.

1. Visit `https://dashboard.render.com` and sign in to your account.
2. Select **New â†’ Web Service**.
3. Connect GitHub when requested and select your `machineguard-ops` repository.
4. Configure:

```text
Name: machineguard-ai
Language/Runtime: Python 3
Branch: main
Root Directory: ai-service
Build Command: pip install -r requirements.txt
Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
Health Check Path: /health
```

5. Under **Environment**, add the LLM variables **only if** you created a key in section 4:

```text
LLM_API_KEY=YOUR_KEY
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=YOUR_CONFIRMED_MODEL_NAME
```

6. Confirm `ai-service/models/` and `ai-service/data/replay/` are committed. Render's free
   tier cannot train a model or hold the 134 MB dataset, so it loads these artifacts at
   startup. Without them `/classify` and `/replay` return 503 while the rest still works.
7. Create the service and wait for a successful deployment.
8. Copy your URL, similar to `https://machineguard-ai-XXXX.onrender.com`.
9. Test `https://YOUR-AI-URL/health`.

These commands match Render's [FastAPI deployment guidance](https://render.com/docs/deploy-fastapi). No Render service or URL is supplied in the project.

## 10. Deploy Express manually on Render

1. Select **New â†’ Web Service** again.
2. Select the same GitHub repository.
3. Configure:

```text
Name: machineguard-api
Language/Runtime: Node
Branch: main
Root Directory: server
Build Command: npm install && npm run build
Start Command: npm start
Health Check Path: /api/health
```

4. Add these values under **Environment**:

```text
NODE_ENV=production
JWT_SECRET=YOUR_GENERATED_JWT_SECRET
MONGODB_URI=YOUR_COMPLETE_ATLAS_URI
AI_SERVICE_URL=https://YOUR-AI-SERVICE.onrender.com
CLIENT_URL=http://localhost:5173
SENSOR_INTERVAL_MS=4000
PERSIST_INTERVAL_MS=30000
READING_TTL_DAYS=7
```

`JWT_SECRET` is mandatory in production: with `NODE_ENV=production` the server refuses to
start without it, rather than silently signing tokens with the development fallback that is
visible in the public repository.

`PERSIST_INTERVAL_MS` and `READING_TTL_DAYS` protect the Atlas free tier. Readings are written
every 30 seconds rather than every tick, and expire after 7 days, which holds storage at
roughly 35 MB instead of growing past the 512 MB limit in about two weeks. Lowering the
interval or raising the TTL will fill a free cluster.

Changing `READING_TTL_DAYS` later requires dropping the existing TTL index by hand; Mongoose
will not alter an index that already exists.

5. Create and deploy the service.
6. Copy your API URL, similar to `https://machineguard-api-XXXX.onrender.com`.
7. Test `https://YOUR-API-URL/api/health`.

Render supports custom Express build/start commands through a connected repository. See the [official Express deployment guide](https://render.com/docs/deploy-node-express-app). Environment values are entered in the individual service dashboard and are applied after saving and redeploying.

### Atlas access from Render

If Atlas blocks Render, configure Atlas Network Access using the approach supported by your Render plan. A broad `0.0.0.0/0` entry permits connection attempts from anywhere and is not ideal for production. Prefer fixed outbound addresses or private networking when available, and always use strong least-privilege database credentials.

## 11. Choose one frontend host

Use Vercel or Firebase Hosting. You do not need both.

### Option A â€” Vercel

1. Visit `https://vercel.com` and sign in.
2. Select **Add New â†’ Project**.
3. Import your `machineguard-ops` GitHub repository.
4. Set the framework to Vite if it is not detected.
5. Set **Root Directory** to `client`.
6. Use:

```text
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

7. Add this Environment Variable:

```text
VITE_API_URL=https://YOUR-RENDER-API.onrender.com/api
```

8. Deploy and copy your Vercel URL.
9. Open the Render `machineguard-api` service.
10. Replace `CLIENT_URL` with the exact Vercel URL and redeploy Express.

Vite browser variables on Vercel require the `VITE_` prefix. Environment changes affect new deployments, so redeploy after changing a value. See [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

### Option B â€” Firebase Hosting

Firebase is not the database for this project. Use it only for frontend hosting or optional future Firebase features.

1. Visit `https://console.firebase.google.com` using your Google account.
2. Select **Add project**, name it `machineguard-ops`, and finish creation.
3. In Project Overview, select the Web icon `</>`.
4. Enter `MachineGuard Web` and register the application.
5. Firebase displays a `firebaseConfig` object containing `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`.
6. Copy matching values into `client/.env` only if you integrate Firebase features:

```env
VITE_FIREBASE_API_KEY=YOUR_VALUE
VITE_FIREBASE_AUTH_DOMAIN=YOUR_VALUE
VITE_FIREBASE_PROJECT_ID=YOUR_VALUE
VITE_FIREBASE_STORAGE_BUCKET=YOUR_VALUE
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_VALUE
VITE_FIREBASE_APP_ID=YOUR_VALUE
VITE_API_URL=https://YOUR-RENDER-API.onrender.com/api
```

Firebase provides this config object when you register a web app. See the [official Firebase web setup](https://firebase.google.com/docs/web/setup).

7. Install and authenticate the CLI:

```powershell
npm install -g firebase-tools
firebase login
firebase use --add
```

8. Select the Firebase project you created.
9. Let `firebase use --add` create the local project mapping, or copy `.firebaserc.example` to `.firebaserc` and replace its placeholder with your project ID.
10. Build and deploy:

```powershell
npm run build --prefix client
firebase deploy --only hosting
```

11. Copy your generated Firebase Hosting URL.
12. Set Render's `CLIENT_URL` to that exact URL and redeploy Express.

## 12. Final ownership and security check

Confirm all of the following:

- MongoDB Atlas project is owned by your account.
- Database user and password were created by you.
- `MONGODB_URI` exists only in `server/.env` and Render's Express environment.
- The LLM key exists only in `ai-service/.env` and Render's AI environment.
- JWT secret was generated by you, and `JWT_SECRET` is set in Render's Express environment.
- `ai-service/models/` and `ai-service/data/replay/` are committed; `ai-service/data/raw/` is not.
- GitHub repository belongs to your account.
- Render services belong to your account.
- Vercel or Firebase project belongs to your account.
- No `.env` file appears in `git status` or GitHub.
- No `YOUR_...` or `PASTE_...` placeholder remains in a deployed environment.
- `CLIENT_URL` is the exact frontend origin with no path after the domain.
- `VITE_API_URL` ends with `/api`.
- Local and hosted health endpoints respond successfully.

The included `render.yaml`, `firebase.json` and `vercel.json` are generic templates. They contain no account ID, service ID, project ID, deployment URL or credential. You may ignore them and follow the manual dashboard steps above.
