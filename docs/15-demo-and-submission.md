# 15 - Judge Runbook and Submission Checklist

[Live demo](https://haqdaar-t2wr.onrender.com/login) · [Service health](https://haqdaar-t2wr.onrender.com/health) · [Transparency](https://haqdaar-t2wr.onrender.com/transparency) · [API docs](https://haqdaar-t2wr.onrender.com/api/docs) · [Official rubric](AI_Hackathon_Evaluation_Rubrics.pdf)

**Submission** Sunday, 22 Nov 2026, 18:00 PKT. **Live evaluation** Monday, 23 Nov 2026, FAST-NUCES Karachi Library.

## Before the judges arrive

- Open the hosted demo on a phone-width window and the staff console in a separate browser profile. Sign in as demo citizen Fatima, Officer Sana, and Auditor Nadia. Confirm `/health` reports a live worker and a healthy database.
- Keep a disposable Docker stack on the presentation laptop. Use it for offline submission, four-eyes approvals, consent withdrawal, and mock outages. Leave the shared hosted cases and rules intact.
- Run the [three-minute walkthrough](../README.md#2-3-minute-judge-walkthrough-live-demo) once. Check that **Next** moves from steps 1 to 2 on the same page and 2 to 3 across pages. Confirm one Sindhi prompt plays with Gemini configured over the room speakers.
- The hosted demo uses `AI_PROVIDER=fake` and real policy retrieval with extractive answers. It serves saved audio and runs the local scam and document checks. Use a separate live-configured instance if demonstrating Deepgram dictation, Gemini synthesis, or Anam video. If a voice provider is unavailable, switch to saved prompts and typed answers.

## Eight-minute walkthrough

| Time | What to show | What the judge can verify |
|---|---|---|
| 0:00–0:40 | Start with Fatima's problem. Weak signal and missing records should not make a widow lose her application. Point to the **Prototype** banner. | The identity, death registry, household, benefit, payment, complaints, and SMS services are simulated. The case workflow and audit trail run in Haqdaar. |
| 0:40–1:35 | As Fatima, choose **سنڌي**, start the tour, progress to **My applications**, and play a prompt if Gemini is configured. Open **Ask a Question** and ask `شناختی کارڈ نہیں ہے تو کیا کروں؟`. | The tour counter advances across routes, the audio plays in the page, and the answer cites **If You Do Not Have a CNIC**. A weather question should return `NOT_SURE`. |
| 1:35–2:10 | Open **Scam checker → Demo messages → Scam: extra fee request**. Then paste `Bhai payment bhej dena`. | The fee request is flagged. The short ambiguous message returns **Cannot tell**. |
| 2:10–3:25 | As Sana, open seeded case `HQ-2026-000101`. Show the document evidence, the structured handoff, and the rules trace. | The officer can distinguish a questionable document from a missing or unreadable one. High risk requires a second officer. |
| 3:25–4:35 | On the disposable stack, submit a synthetic application while offline and reconnect. Follow the same reference until it syncs. If rehearsed, show one officer approval and the second officer's approval on a flagged case. | One queued submission produces one server case. A separate officer must authorize a case that requires four-eyes review. |
| 4:35–5:35 | In the disposable stack, withdraw Helper Ayesha's access as Fatima and retry the read as Ayesha. | The read is blocked. Fatima can see the denied access in her consent log. |
| 5:35–6:45 | Open **Evaluation**. Compare the expected cost of routing at two thresholds. On the local stack, show **Digital Twin** for a draft rule change. | The evaluation uses labelled synthetic cases. The draft preview shows changed cases and budget impact without publishing rules. |
| 6:45–8:00 | As Nadia, verify the audit chain. Show the source of an earlier decision and then open **Transparency**. | The chain checks the logged decisions. The app distinguishes simulated services, synthetic inputs, and the actual features that process them. |

Use seeded cases if the worker or network makes a new submission too slow for the slot. Keep a short recording of the locally rehearsed offline and consent flows available if the live connection drops.

## Evidence to keep

Record the commit, device, data set size, provider mode, and observed result with each capture.

| Rubric | Best proof | Limit to state |
|---|---|---|
| AI implementation (30) | A scam verdict and abstention, signed document evidence on a review case, a cited answer and abstention, and the cost sweep. | The benchmarks use synthetic data. Live dictation accuracy needs repeated spoken trials. |
| SaaS and architecture (20) | Switch between the citizen, officer, and auditor accounts. Show health, the queue, and API docs. | Demo login uses seeded personas. Third-party public services are mocked. |
| Problem solving (15) | Follow one case reference from offline queue to review, and show the citizen's next action. | A local rehearsal demonstrates functionality. Any impact figures come from labelled scenarios. |
| Accessibility (10) | A narrow screen, Sindhi tour audio, editable confirmation, and a submission retry on reconnection. | Sindhi playback needs the Gemini API and internet access. Ask's answer corpus is currently Urdu and English. |
| Safety and reliability (15) | Block a withdrawn consent read, inspect the audit chain, show uncertainty and independent second approval. | If the optional conversational avatar is shown, open the Anam microphone disclosure before starting it and speak only synthetic examples. |
| Innovation (10) | Preview a rules change with Digital Twin and compare it with the recorded version of an earlier decision. | Projected budget changes are simulations. |

## Submission checklist

- [x] Public app, health endpoint, API docs, and repository instructions linked from the README.
- [x] Demo personas, transparency disclosures, and a short and long presentation path documented.
- [ ] Rehearse the disposable local stack on the presentation laptop, including offline sync and the second officer's approval.
- [ ] Have a native Sindhi speaker check the generated speech and repeat the live number and date dictation cases with synthetic inputs.
- [ ] Record the four-to-five-minute demo, make the video link accessible without sign-in, and add it to the README and submission form.
- [ ] Submit the final links and check them in a private browser window.
