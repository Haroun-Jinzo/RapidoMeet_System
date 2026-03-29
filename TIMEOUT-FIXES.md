# Timeout Issues & Fixes (March 28, 2026)

## Root Cause Analysis

Your "Pipeline failed - Request timed out" error was caused by **three timeout bottlenecks**:

### 1. **N8N Webhook Timeout (CRITICAL) 🔴**
- **Location**: `src/dispatcher.ts` line 270
- **Problem**: 30-second timeout for N8N webhooks
- **Why it fails**: External integrations (CRM create contact, Calendar create event, Email send) often take 30-60+ seconds
  - Salesforce API calls: 20-40s
  - Google Calendar API: 15-30s
  - Email sending services: 10-20s
  - Network latency & retries: +5-10s
- **Fix**: Increased to **120 seconds (2 minutes)**
- **Impact**: N8N calls won't timeout prematurely

### 2. **Gemini Extraction API (MEDIUM) 🟡**
- **Location**: `src/extract.ts` line 158
- **Problem**: No explicit timeout on Gemini `generateContent()` call
- **Why it fails**: If Gemini API is slow/unresponsive, request hangs indefinitely
- **Fix**: Added **60-second timeout** with Promise.race()
- **Impact**: Extraction won't hang forever; fails cleanly with clear error message

### 3. **Gemini Routing API (MEDIUM) 🟡**
- **Location**: `src/router.ts` line 117
- **Problem**: Same issue as extraction - no explicit timeout
- **Fix**: Added **60-second timeout** with Promise.race()
- **Impact**: Routing won't hang forever; fails cleanly with clear error message

### 4. **Retry Backoff Strategy (MINOR) 🟢**
- **Location**: `src/dispatcher.ts` line 161
- **Problem**: Exponential backoff was 1s → 2s → 4s = too fast for slow APIs
- **Fix**: Changed to 2s → 4s → 8s = more patient with external services
- **Impact**: Better chance of recovery from transient API failures

---

## Timeline of Timeout Failures

```
Request arrives at /api/process
  ↓
1. Transcription (10 min timeout) ✅ OK
  ↓
2. Skill detection ✅ OK
  ↓
3. Gemini Extraction (60 sec timeout) ✅ NOW FIXED
  ↓
4. Gemini Routing (60 sec timeout) ✅ NOW FIXED
  ↓
5. N8N Dispatch
   → crm.create_contact (WAS 30s, NOW 120s) ✅ NOW FIXED
   → calendar.create_event (WAS 30s, NOW 120s) ✅ NOW FIXED
   → email.send_recap (WAS 30s, NOW 120s) ✅ NOW FIXED
   → etc...
  ↓
6. Report formatting ✅ OK
  ↓
7. Send notifications ✅ OK
```

---

## New Timeout Configuration

| Component | Previous | New | Reason |
|-----------|----------|-----|--------|
| **Groq Transcription API** | 10 min | 10 min | Large audio files need time |
| **Groq Local Whisper** | 30 min | 30 min | Python subprocess allows longer |
| **Gemini Extraction** | ∞ (none) | 60 sec | Prevent indefinite hanging |
| **Gemini Routing** | ∞ (none) | 60 sec | Prevent indefinite hanging |
| **N8N Webhook Calls** | 30 sec | **120 sec** | External APIs need 30-60+ sec |
| **Dispatch Retry Backoff** | 1s, 2s, 4s | **2s, 4s, 8s** | More patient with slow APIs |
| **Local Whisper Fallback (Size)** | 10 MB limit | **24 MB limit** | Use fast Groq API for files up to 24MB |
| **Local Whisper Model** | large-v3 | **base** | CPU fallback is 10x faster running base vs large-v3 |
| **Server-level** | 30 min | 30 min | Overall request timeout |

---

## How to Test the Fixes

### 1. Test with a short meeting (< 5 min audio)
```bash
npm run test:sample
```
This should **complete successfully** with all 7 pipeline steps visible in logs.

### 2. Test N8N timeout specifically
If you have N8N configured:
```bash
# Set N8N_READY = true in src/dispatcher.ts
# Then run a test

# You should see:
# [Dispatcher] ✓ crm.create_contact — attempt 1/3
# [Dispatcher] ✓ calendar.create_event — attempt 1/3
# etc... (all within 120 seconds)
```

### 3. Monitor timeout errors
Look for these error patterns in logs:
- ❌ **OLD**: "Request timed out" + generic error
- ✅ **NEW**: "Gemini extraction timeout (60s)" or "N8N webhook returned 504" (clear error)

---

## If Timeouts Still Occur

1. **Check which step is timing out**:
   - Look at the last log message before the error
   - Is it happening in Transcription? Extraction? Routing? Dispatch?

2. **For Gemini timeouts** (extraction/routing):
   - Verify `GEMINI_API_KEY` is valid
   - Check Google Cloud API quota limits
   - Increase timeout in `extract.ts` or `router.ts` (currently 60s)

3. **For N8N timeouts** (dispatch):
   - Verify `N8N_WEBHOOK_BASE_URL` and `N8N_API_KEY` are correct
   - Increase timeout in `dispatcher.ts` (currently 120s)
   - Check N8N logs to see if workflows are actually executing

4. **For Groq timeouts** (transcription):
   - Very unlikely with 10-minute timeout
   - Check if audio file is corrupted or unusually large
   - Verify `GROQ_API_KEY` is valid

---

## Future Improvements

- [ ] Add configurable timeout env variables (per API)
- [ ] Implement request-level monitoring/metrics
- [ ] Add detailed timeout logs with which component failed
- [ ] Create circuit breaker dashboards for API health
- [ ] Implement adaptive timeout based on response times

