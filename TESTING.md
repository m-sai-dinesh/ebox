# Testing Strategy (TESTING.md)

This document outlines the testing architecture, strategies, and coverage for the Autonomous AI Sales System.

> **CRITICAL STATUS:** Automated testing is **Not currently implemented** in this repository. 

There are no test frameworks, CI/CD pipelines, or unit/integration tests present in the codebase. All testing is currently performed manually by running the server and initiating a phone call.

---

## 1. Testing Overview

**Not currently implemented.**

The repository lacks unit tests, integration tests, API tests, component tests, end-to-end tests, database tests, and mock utilities.

---

## 2. Testing Stack

| Testing Layer | Framework/Tool | Purpose | Current Status |
| ------------- | -------------- | ------- | -------------- |
| Unit | None | - | **Not currently implemented** |
| Integration | None | - | **Not currently implemented** |
| E2E | None | - | **Not currently implemented** |

---

## 3. Test Directory Structure

**Not currently implemented.**

There are no `tests/`, `spec/`, or fixture directories in the repository.

---

## 4. Running Tests

Currently, the `package.json` contains a placeholder script:

```bash
npm test
```
*Output: `Error: no test specified`*

Watch mode, coverage mode, and debug mode are **Not currently implemented**.

---

## Sections 5 through 16: Specific Test Coverage

The following testing layers are **Not currently implemented**:
* **5. Unit Testing**
* **6. Integration Testing**
* **7. API Testing**
* **8. Frontend Testing**
* **9. End-to-end Testing**
* **10. Database Testing**
* **11. Mocking Strategy**
* **12. Test Data**
* **13. Authentication Testing**
* **14. Error & Edge Case Testing**
* **15. External Service Testing**
* **16. AI/ML Testing** (AI-specific testing is not currently implemented)

---

## 17. Coverage

> Coverage percentage could not be determined from the repository.

No coverage tools (e.g., Istanbul/nyc, Jest coverage) are configured.

---

## 18. CI/CD Testing

**Not currently implemented.** 
There are no GitHub Actions, Jenkins files, or Gitlab CI pipelines configured to run tests on Pull Requests.

---

## 19. Test Naming & Conventions

**Not currently implemented.**

---

## 20. Testing Important Business Flows

**Not currently implemented.** 
Currently, all business flows must be verified manually by the developer on a live phone call.

---

## 21. Testing Gaps

| Area | Current Coverage | Risk | Missing Tests | Priority |
| ---- | ---------------- | ---- | ------------- | -------- |
| **Audio Transcoder** | 0% | High | Unit tests for `muLawToPcm16` bitwise operations | High |
| **AI Parsing** | 0% | High | Tests to ensure prompt outputs correct tool formats | High |
| **WhatsApp Client** | 0% | Medium | Integration tests verifying headless browser launches | Medium |
| **Express Routes** | 0% | Low | API tests verifying Twilio receives valid TwiML | Medium |
| **Callback Persistence** | 0% | High | Tests verifying concurrent writes to `callbacks.json` don't corrupt | High |

---

## Recommended Improvements

To bring this repository up to standard production quality, the following testing architecture is recommended:

### 1. Introduce a Test Runner (Jest)
Install Jest and Supertest to begin testing the pure functions and API endpoints.
* **Why:** To safely modify the `muLawToPcm16` transcoder and Express routes without fear of regressions.

### 2. Mocking External Services (Critical)
Because this application relies on paid APIs (Twilio, Gemini, Sarvam), running live tests on every commit will drain account balances and cause flakiness.
* **Recommendation:** Create stubs for `waClient`, `twilioClient`, and the `fetch` calls to Sarvam. 
* **Recommendation:** Mock the WebSocket server to simulate Twilio sending mu-law audio streams without needing an actual phone call.

### 3. CI/CD Pipeline
* **Recommendation:** Add a simple GitHub Action (`.github/workflows/test.yml`) to run `npm test` on every push to the `main` branch.

### 4. Isolate the Database
* **Recommendation:** Refactor the hardcoded `./callbacks.json` path to use an environment variable (e.g., `process.env.DB_PATH`). This allows test scripts to write to a temporary file (`test-callbacks.json`) and delete it during cleanup, preventing tests from corrupting local dev data.

---

## 23. Test Execution Matrix

| Test Type   | Local | CI  | Production | Command        |
| ----------- | ----- | --- | ---------- | -------------- |
| Unit        | ✗     | ✗   | ✗          | N/A            |
| Integration | ✗     | ✗   | ✗          | N/A            |
| E2E         | ✗     | ✗   | ✗          | N/A            |

---

## 24. Final Testing Checklist

*(None applicable at this time)*
