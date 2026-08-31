# BLUEPRINT DISCOVERY INPUT TEMPLATE

<!-- @tg-golden-rule: BEFORE debugging, validate inside-out (Layer 1-7). -->
<!-- Read: docs/agent-contracts/AGENT_LEGO_BLOCK_GOLDEN_RULE.md -->

**Created:** June 3, 2026  
**Purpose:** Structured questionnaire for solution discovery - fill out offline, upload to agent for blueprint generation  
**Format:** Markdown form (copy/paste, fill in, attach to agent chat)  
**Alternative Formats:** Voice transcript, meeting notes, brain dump recording

---

## 📋 HOW TO USE THIS TEMPLATE

### **Option 1: Fill Out Form (15-30 minutes)**
1. Copy this entire document
2. Replace `[YOUR ANSWER HERE]` with your responses
3. Save as `DISCOVERY_[SolutionName]_[Date].md`
4. Attach to agent chat with message: "Process this discovery input and generate blueprint"

### **Option 2: Voice Recording (10-15 minutes)**
1. Record yourself answering questions out loud (use phone voice memo, Zoom recording, etc.)
2. Transcribe via Whisper, Otter.ai, or manual transcription
3. Paste transcript below with heading `## VOICE TRANSCRIPT`
4. Attach to agent chat with message: "Extract discovery answers from this transcript and generate blueprint"

### **Option 3: Meeting Notes (existing context)**
1. If you already have requirements docs, meeting notes, customer interviews
2. Paste all relevant context below with heading `## CONTEXT DOCUMENTS`
3. Attach to agent chat with message: "Extract discovery answers from these documents and generate blueprint"

### **Option 4: Brain Dump (stream of consciousness)**
1. Just start writing/talking about the solution you want
2. Don't follow question structure - just brain dump for 15 minutes
3. Attach to agent with message: "Parse this brain dump, ask clarifying questions for gaps, then generate blueprint"

---

## 🎯 PHASE 1: GENESIS & MOTIVATION (5 Questions)

### **State: INITIAL_INTAKE**
**Status:** [ ] Not Started  [ ] In Progress  [X] Complete  
**Completion Criteria:** All 5 questions answered OR explicit "skip discovery" confirmation

---

### **Q1: What triggered this request?**

**Select one:**
- [ ] A) Real-world pain I experienced personally
- [ ] B) Customer/stakeholder request
- [ ] C) Competitive gap I observed
- [ ] D) Strategic initiative from leadership
- [ ] E) Other (describe)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example: "I was asked to submit an SME speaker proposal to a conference and the process was 40+ manual steps across disconnected systems. No visibility into review status, had to coordinate travel/logistics separately, no lead capture mechanism."
```

**Follow-up: Describe the specific incident or pain point:**
```
[YOUR ANSWER HERE]

Example: "I submitted the proposal and heard nothing for 60 days. Then got acceptance with 2 weeks to book travel, create slides, coordinate with exhibitor booth team - all in separate systems. Lost 30+ leads because badge scan data wasn't captured in CRM."
```

---

### **Q2: Who is the PRIMARY stakeholder?**

**Select one:**
- [ ] A) Internal team (specify department: _______)
- [ ] B) External customers (specify segment: _______)
- [ ] C) Partners/vendors
- [ ] D) Multiple equal stakeholders (list: _______)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example: "D) Multiple stakeholders:
  1. Conference organizers (event management companies, associations)
  2. SME speakers (independent consultants, industry experts)
  3. Exhibitors (manufacturing vendors, service providers)
  4. Attendees (supply chain professionals, operations managers)"
```

**Follow-up: If multiple, which stakeholder's pain is MOST URGENT?**
```
[YOUR ANSWER HERE]

Example: "Conference organizers - they're spending 200+ hours manually coordinating each event. If we save them 60% of that time, they'll pay for the platform."
```

---

### **Q3: Walk through the CURRENT manual process**

**Describe the current state (no solution exists yet). List major steps with timeframes:**

**Step-by-step process:**
```
[YOUR ANSWER HERE]

Example:
Step 1 (Day 1): Research industry event calendar (manual spreadsheet search across 10+ websites)
Step 2 (Day 30): Define event tracks, session types, speaker criteria (PowerPoint deck)
Step 3 (Day 60): Launch call for proposals (Google Form, emails to speaker network)
Step 4 (Day 75): Manually review 200+ proposals in spreadsheet
Step 5 (Day 90): Assign proposals to reviewers (email threads with attachments)
Step 6 (Day 100): Chase reviewers for feedback (10+ follow-up emails per reviewer)
Step 7 (Day 120): Select top 40 proposals (manual scoring in Excel)
Step 8 (Day 125): Send acceptance letters (mail merge in Word)
Step 9 (Day 135): Track speaker confirmations (manual spreadsheet updates)
Step 10 (Day 150): Create event agenda (PowerPoint formatting hell - 15+ hours)
Step 11 (Day 180): Event day coordination (chaos - AV failures, speaker no-shows, manual task tracking)
Step 12 (Post-event): Lead capture (30+ hours manual data entry from badge scans into CRM)
```

**Of those steps, which 5 are MOST PAINFUL (time-consuming, error-prone, frustrating)?**
```
1. [STEP NUMBER + WHY PAINFUL]
2. [STEP NUMBER + WHY PAINFUL]
3. [STEP NUMBER + WHY PAINFUL]
4. [STEP NUMBER + WHY PAINFUL]
5. [STEP NUMBER + WHY PAINFUL]

Example:
1. Step 5 (Assign proposals to reviewers) - 10+ hours of email threading, version control nightmare
2. Step 6 (Chase reviewers) - 20+ hours of follow-up, no visibility into completion status
3. Step 10 (Create agenda) - 15+ hours of PowerPoint formatting, every change breaks layout
4. Step 11 (Event day coordination) - 50+ hours of firefighting, no real-time task queue
5. Step 12 (Lead capture) - 30+ hours manual data entry, high error rate, delayed follow-up
```

---

### **Q4: What's the SUCCESS METRIC?**

**Select one and provide specific number:**
- [ ] A) Time reduction (X% faster)
- [ ] B) Cost reduction (save $X)
- [ ] C) Revenue increase (generate $X)
- [ ] D) Adoption rate (X% of target users active)
- [ ] E) Quality improvement (X% fewer errors)
- [ ] F) Other (describe)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example: "A) Time reduction - Conference organizers reduce event coordination time by 60% (from 200 hours to 80 hours per event). If we can save 120 hours per event and they run 10 events/year, that's 1200 hours saved = $120K value (at $100/hr labor cost)."
```

**Follow-up: How will you MEASURE this metric in 6 months?**
```
[YOUR ANSWER HERE]

Example: "Track time spent per event phase:
  - Pre-event planning (baseline: 80 hrs → target: 30 hrs)
  - Proposal review cycle (baseline: 60 hrs → target: 20 hrs)
  - Event day coordination (baseline: 50 hrs → target: 20 hrs)
  - Post-event follow-up (baseline: 30 hrs → target: 10 hrs)
Total: 220 hrs → 80 hrs (64% reduction)"
```

---

### **Q5: Scope boundary - ONE use case or MULTIPLE?**

**Select one:**
- [ ] A) Single use case (narrow, deep) - describe: ______
- [ ] B) Multiple related use cases (broader, extensible) - list: ______
- [ ] C) Platform (reusable across many domains)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example: "B) Multiple related use cases:
  1. Tradeshows and in-person conferences (PRIMARY - build first)
  2. Virtual events and webinars (PHASE 2 - reuse speaker/content management)
  3. Hybrid events (PHASE 3 - combine in-person + virtual)
  4. Internal lunch-and-learns (FUTURE - simplified version for internal teams)"
```

**Follow-up: If multiple, which use case should we build FIRST (MVP)?**
```
[YOUR ANSWER HERE]

Example: "Use Case 1 (Tradeshows and in-person conferences). Specifically focus on:
  - 100-500 person events
  - 30-60 session tracks
  - 10-20 exhibitor booths
  - Single-day or multi-day formats"
```

---

## ✅ PHASE 1 CHECKPOINT

**Agent Validation Questions (answer these to confirm your context):**

1. **What's the one-sentence summary of this solution?**
   ```
   [YOUR ANSWER HERE]
   
   Example: "A multi-tenant SaaS platform that automates tradeshow and conference management from proposal submission through post-event lead capture, reducing coordination time by 60%."
   ```

2. **What happens if we DON'T build this solution?**
   ```
   [YOUR ANSWER HERE]
   
   Example: "Conference organizers continue spending 200+ hours per event, manually coordinating proposals/logistics. We lose competitive advantage as competitors launch similar platforms. Exhibitors go elsewhere due to poor lead capture ROI."
   ```

3. **What's the #1 risk that could cause this solution to fail?**
   ```
   [YOUR ANSWER HERE]
   
   Example: "Low adoption - if conference organizers perceive the learning curve is too steep (they're used to spreadsheets), they won't migrate. Mitigation: Make MVP dead simple (3 features max), focus on immediate time savings."
   ```

---

## 🔍 PHASE 2: SCOPE & BOUNDARIES (5 Questions)

### **State: CONTEXT_CLARIFICATION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete  
**Completion Criteria:** Clarifying questions answered, gaps filled

---

### **Q6: MVP Definition - If you could ONLY build 3 features to prove value, which 3?**

**Feature 1:**
```
[FEATURE NAME + WHY CRITICAL]

Example: "Proposal Submission & Review Workflow - Automates the most painful steps (Q3 Steps 5-7). Saves 30+ hours per event. Directly addresses conference organizer's top pain point."
```

**Feature 2:**
```
[FEATURE NAME + WHY CRITICAL]

Example: "Event Day Command Center with Real-Time Task Queue - Solves the chaos problem (Q3 Step 11). Butler pattern for task escalation. Saves 30+ hours of firefighting."
```

**Feature 3:**
```
[FEATURE NAME + WHY CRITICAL]

Example: "Lead Capture Dashboard with CRM Export - Eliminates manual data entry (Q3 Step 12). Direct Salesforce integration. Saves 30+ hours post-event, improves exhibitor ROI."
```

**What's Phase 2? (next 3 features after MVP proves value)**
```
[YOUR ANSWER HERE]

Example:
  - Phase 2 Feature 1: Exhibitor Booth Management (floor plan designer, vendor coordination)
  - Phase 2 Feature 2: Attendee Personalization (session recommendations, custom agenda builder)
  - Phase 2 Feature 3: Event Budget Tracker (cost forecasting, vendor quote comparison)
```

**What's Phase 3? (nice-to-have, future enhancements)**
```
[YOUR ANSWER HERE]

Example:
  - Phase 3 Feature 1: AI-powered proposal scoring (match proposals to tracks automatically)
  - Phase 3 Feature 2: Automated travel booking (integrate with Expedia/Concur)
  - Phase 3 Feature 3: Post-event analytics dashboard (ROI tracking, NPS surveys)
```

---

### **Q7: What's explicitly OUT of scope?**

**List what we should NOT build (someone else's problem):**
```
[YOUR ANSWER HERE]

Example:
  1. Hotel booking engine - Just track reservations, link to Expedia/Booking.com for actual booking
  2. Catering menu management - Just RFQ workflow, don't build menu builder
  3. Badge printing - Integrate with existing badge printer APIs (Zebra, Evolis), don't build print driver
  4. Virtual event hosting - Use Zoom/Teams for video, don't build WebRTC infrastructure
  5. Payment processing - Embed Stripe widget, don't handle PCI compliance ourselves
```

---

### **Q8: Integration requirements - What external systems MUST we integrate with?**

**Must-have integrations (blockers if missing):**
```
Integration 1: [SYSTEM NAME] - [PURPOSE] - [DIRECTION: inbound/outbound/bidirectional] - [FREQUENCY: real-time/nightly/on-demand]

Example:
  1. Salesforce - Export leads with scoring after event - Outbound - On-demand (post-event button click)
  2. Stripe - Process registration payments - Bidirectional - Real-time (embed payment widget)
  3. Mailchimp - Send email campaigns to attendees - Outbound - On-demand (session reminders, post-event surveys)
```

**Nice-to-have integrations (Phase 2/3):**
```
[YOUR ANSWER HERE]

Example:
  1. Zoom - Virtual session hosting for hybrid events (Phase 2)
  2. QuickBooks - Expense tracking and budget reconciliation (Phase 3)
  3. LinkedIn - Speaker bio enrichment (auto-pull headshots, bios) (Phase 3)
```

---

### **Q9: Hard constraints - Budget, timeline, compliance?**

**Budget constraint:**
```
[YOUR ANSWER HERE]

Example: "$50K total budget for MVP (4 weeks development). Must use free/low-cost tools where possible. Already paying for MUI DataGrid Pro ($249/year), Stripe (2.9% + $0.30 per transaction). Avoid Enterprise licenses (AG Grid, Salesforce Enterprise)."
```

**Timeline constraint:**
```
[YOUR ANSWER HERE]

Example: "Must launch MVP by September 1, 2026 (12 weeks from now). Q4 is peak event season - need to onboard 3 pilot customers before October events. Hard deadline."
```

**Compliance constraint:**
```
[YOUR ANSWER HERE]

Example: "GDPR for EU attendees (consent tracking, right to deletion, data export). PCI-DSS for payment processing (handled by Stripe, not our problem). No HIPAA (not healthcare events)."
```

**Technology constraint:**
```
[YOUR ANSWER HERE]

Example: "Must use existing stack (React + MUI, Python FastAPI, SQL Server). No new languages/frameworks. Must deploy to existing Azure infrastructure (Static Web Apps + VM API)."
```

---

### **Q10: Data volume and performance expectations?**

**Concurrent users:**
```
[YOUR ANSWER HERE]

Example: "5000 concurrent users during event registration window (2-week sprint before event). 50 concurrent users during normal operations (organizers, speakers reviewing proposals)."
```

**Total data volume:**
```
[YOUR ANSWER HERE]

Example:
  - Year 1: 50 events, 2000 proposals, 500 speakers, 2000 sessions, 10K attendees
  - Year 3: 500 events, 20K proposals, 5000 speakers, 20K sessions, 100K attendees
  - Data retention: 3 years (purge after), audit logs 1 year
```

**Performance expectations:**
```
[YOUR ANSWER HERE]

Example:
  - Dashboard load time: <2 seconds (user tolerance threshold)
  - Event day command center: 5-second refresh (real-time task queue)
  - Proposal submission: <3 seconds (fast feedback loop)
  - CRM export: <10 seconds for 500 leads (background job for >500)
```

---

## 👥 PHASE 3: STAKEHOLDER PERSONAS (5 Questions)

### **State: PERSONA_DEFINITION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

---

### **Q11: Who are the 3-5 PRIMARY user personas?**

**Persona 1:**
```
Role Title: [e.g., Conference Organizer]
Organization Type: [e.g., Association, Event Management Company]
Primary Job-to-be-Done: [one sentence]
Technical Sophistication: [ ] Non-technical  [ ] Moderately technical  [ ] Highly technical
Frequency of Use: [ ] Daily  [ ] Weekly  [ ] Monthly  [ ] Event-driven (only during events)

Example:
Role Title: Conference Organizer
Organization Type: Industry Association / Event Management Company
Primary Job-to-be-Done: Coordinate 500-person multi-day event with 40 sessions, 20 exhibitors, 3-month planning cycle
Technical Sophistication: Moderately technical (comfortable with CRM, email marketing tools, but not SQL)
Frequency of Use: Daily during event planning (3 months), hourly during event execution (2 days)
```

**Persona 2:**
```
[REPEAT FORMAT]

Example:
Role Title: SME Speaker
Organization Type: Independent Consultant / Corporate Subject Matter Expert
Primary Job-to-be-Done: Submit proposals to 10+ events/year, manage speaking calendar, track acceptance rate, capture leads from presentations
Technical Sophistication: Non-technical (marketing/sales background, not IT)
Frequency of Use: Weekly (submit proposals, check status), Event-driven (upload slides, view leads)
```

**Persona 3:**
```
[REPEAT FORMAT]

Example:
Role Title: Exhibitor Marketing Manager
Organization Type: Manufacturing Vendor / Service Provider
Primary Job-to-be-Done: Track booth ROI across 20+ events/year, coordinate vendor logistics (booth design, materials shipping), capture leads, measure pipeline attribution
Technical Sophistication: Moderately technical (uses CRM, marketing automation)
Frequency of Use: Weekly (booth reservations, vendor coordination), Daily during events (lead capture)
```

**Persona 4 (optional):**
```
[REPEAT FORMAT]
```

**Persona 5 (optional):**
```
[REPEAT FORMAT]
```

---

### **Q12: For EACH persona, what's their critical workflow?**

**Use format:** "As [Persona], I need to [Action] so that [Outcome]"

**Persona 1 Workflow:**
```
[YOUR ANSWER HERE]

Example:
As Conference Organizer, I need to:
  1. Launch CFP (call for proposals) with 60-day deadline
  2. Assign 200+ proposals to 5 reviewers (40 proposals each)
  3. Chase reviewers for feedback (auto-escalate if 7+ days no response)
  4. Select top 40 proposals based on reviewer scores + strategic fit
  5. Send acceptance letters with speaker confirmation deadline
  6. Track speaker confirmations (auto-escalate if no response in 7 days)
  7. Publish event agenda 30 days before event
So that I reduce coordination time from 200 hours to 80 hours (60% savings)
```

**Persona 2 Workflow:**
```
[YOUR ANSWER HERE]

Example:
As SME Speaker, I need to:
  1. Browse event calendar with strategic fit scoring (my expertise vs. event audience)
  2. Submit proposals with bio/headshot reuse (don't re-enter every time)
  3. Track proposal status (submitted → under review → accepted/rejected)
  4. Receive acceptance notification with action items (confirm, submit slides, book travel)
  5. Upload presentation slides with version control
  6. View lead capture dashboard post-event (who attended my session, contact info)
So that I increase my acceptance rate from 30% to 50% and capture 10x more leads
```

**Persona 3 Workflow:**
```
[YOUR ANSWER HERE]
```

---

### **Q13: For EACH persona, what's on their dashboard?**

**Persona 1 Dashboard (Conference Organizer):**
```
[YOUR ANSWER HERE]

Example:
Widgets on Event Planner Dashboard:
  1. Proposal Funnel (submitted → under review → accepted → confirmed) - Bar chart
  2. Registration Curve (actual vs. target by day) - Line chart with forecast
  3. Task Alerts (overdue items, escalations) - Color-coded list (red/yellow/green)
  4. Budget Tracker (actual vs. forecast by category) - Gauge chart
  5. Reviewer Completion Status (% complete per reviewer) - Progress bars
  6. Top Session Scores (highest-rated proposals) - Ranked list with star ratings
  7. Speaker Confirmation Status (confirmed / pending / no response) - Pie chart

Export capabilities: CSV (proposal list), PDF (executive summary), PowerPoint (agenda with branding)
```

**Persona 2 Dashboard (SME Speaker):**
```
[YOUR ANSWER HERE]

Example:
Widgets on Speaker Portal:
  1. My Proposals (status breakdown: draft / submitted / under review / accepted / rejected) - Kanban board
  2. Upcoming Engagements (next 90 days) - Calendar view with travel details
  3. Action Items (slides due, confirmation pending) - To-do list with due dates
  4. Lead Capture Stats (leads per event, conversion rate) - Bar chart
  5. Speaking History (past events, session ratings, attendee feedback) - Timeline
  6. Recommended Events (based on expertise tags) - Card view with strategic fit score

Export capabilities: iCal (speaking calendar), CSV (lead export), PDF (speaking portfolio)
```

**Persona 3 Dashboard:**
```
[YOUR ANSWER HERE]
```

---

### **Q14: Are there ADMIN vs. END USER roles?**

**Select one:**
- [ ] A) Single-tier (everyone has same access)
- [ ] B) Multi-tier (admin configures, users execute)
- [ ] C) Complex (3+ role levels with inheritance)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example: "B) Multi-tier:
  - Super Admin: Configure org settings, manage user accounts, view all events across all orgs (TTP_ID override)
  - Event Admin (Conference Organizer): Create events, assign reviewers, approve proposals, configure workflows for THEIR events only
  - Reviewer: Read-only access to assigned proposals, submit scores, cannot approve/reject
  - Speaker: Read-only access to their own proposals, upload slides, view their leads
  - Exhibitor: Manage their booth reservations, view their leads
  - Attendee: View event agenda, register for sessions, rate sessions post-event
"
```

**What can users self-service vs. what requires admin approval?**
```
[YOUR ANSWER HERE]

Example:
Self-service (no approval):
  - Speaker submit proposal (instant)
  - Attendee register for event (instant, auto-charge via Stripe)
  - Exhibitor reserve available booth (instant, pending design approval)

Requires approval:
  - Proposal acceptance (Event Admin must click "Accept")
  - Booth design changes (Event Admin must approve floor plan)
  - Refund requests (Super Admin only)
  - Event cancellation (Super Admin only, triggers notifications to all attendees)
```

---

### **Q15: What's the mobile vs. desktop split?**

**Select pattern for each persona:**
- [ ] Desktop-only (admin tools, complex workflows)
- [ ] Mobile-first (on-the-go, event day)
- [ ] Responsive (both, optimize for each)

**Your Answer:**
```
[YOUR ANSWER HERE]

Example:
  - Conference Organizer: Desktop-only (complex workflows, large grids, multi-monitor setup)
  - SME Speaker: Responsive (submit proposals on desktop, check status on mobile)
  - Exhibitor: Responsive (booth design on desktop, lead capture on mobile at event)
  - Event Logistics Coordinator: Mobile-first (task queue on iPad during event day)
  - Attendee: Mobile-first (session registration, agenda builder, QR code check-in)
```

---

## 📊 PHASE 4: DATA & ENTITIES (5 Questions)

### **State: DATA_MODEL_DEFINITION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

---

### **Q16: What are the 5-10 CORE entities?**

**List the "things" this solution manages (nouns):**

**Entity 1:**
```
Name: [e.g., Event_Master]
Description: [one sentence]
Estimated Row Count: [Year 1 / Year 3]
Time-Series or Transactional: [ ] No  [ ] Yes (describe pattern)

Example:
Name: Event_Master
Description: Industry conferences and tradeshows (one row per event)
Estimated Row Count: 50 (Year 1) / 500 (Year 3)
Time-Series: No (master record, not transaction log)
```

**Entity 2:**
```
[REPEAT FORMAT]

Example:
Name: Proposal_Submissions
Description: Speaker proposals for event sessions (one row per proposal)
Estimated Row Count: 2000 (Year 1) / 20K (Year 3)
Time-Series: No (master record with state transitions logged separately)
```

**Entity 3-10:**
```
[REPEAT FORMAT FOR EACH ENTITY]

Example entities:
  3. Speaker_Master (SME speaker directory)
  4. Session_Schedule (scheduled presentations)
  5. Content_Track_Master (event tracks - Leadership, Technology, Operations)
  6. Booth_Reservations (exhibitor floor plan)
  7. Attendee_Registrations (event sign-ups)
  8. Event_Tasks (Butler pattern queue)
  9. Lead_Capture_Scans (badge scan transactions - TIME-SERIES)
  10. Proposal_Review_Scores (reviewer ratings - TIME-SERIES)
```

---

### **Q17: For EACH entity, what are the 10 MUST-HAVE fields?**

**Entity 1 Fields:**
```
Entity: [Name from Q16]
1. [Field Name] - [Data Type] - [Required/Optional] - [Purpose]
2. [Field Name] - [Data Type] - [Required/Optional] - [Purpose]
...
10. [Field Name] - [Data Type] - [Required/Optional] - [Purpose]

Example:
Entity: Event_Master
1. Event_ID - INT - Required - Primary key (auto-increment)
2. Event_Name - NVARCHAR(200) - Required - Display name (e.g., "Supply Chain Summit 2026")
3. Event_Start_Date - DATE - Required - First day of event
4. Event_End_Date - DATE - Required - Last day of event
5. Venue_Name - NVARCHAR(200) - Required - Location (e.g., "McCormick Place Chicago")
6. City - NVARCHAR(100) - Required - For filtering/search
7. State - NVARCHAR(50) - Required - For filtering/search
8. Organizer_Org_ID - INT - Required - FK to Organization_Master (TTP_ID isolation)
9. Expected_Attendee_Count - INT - Optional - Capacity planning
10. CFP_Open_Date - DATE - Required - Call for proposals start date
```

**Entity 2 Fields:**
```
[REPEAT FORMAT FOR TOP 3-5 CORE ENTITIES]
```

---

### **Q18: What are the RELATIONSHIPS between entities?**

**Use format:** "One [Entity A] has many [Entity B]"

**Primary Relationships:**
```
[YOUR ANSWER HERE]

Example:
  1. One Event_Master has many Proposal_Submissions (1:N)
  2. One Proposal_Submissions belongs to one Speaker_Master (N:1)
  3. One Speaker_Master can have many Proposal_Submissions (1:N) - across multiple events
  4. One Event_Master has many Session_Schedule (1:N) - scheduled sessions after proposals accepted
  5. One Session_Schedule belongs to one Proposal_Submissions (1:1) - accepted proposal becomes scheduled session
  6. One Event_Master has many Booth_Reservations (1:N)
  7. One Booth_Reservations belongs to one Organization_Master (N:1) - exhibitor company
  8. One Event_Master has many Attendee_Registrations (1:N)
  9. One Attendee_Registrations belongs to one PFUser_Master (N:1)
  10. One Session_Schedule has many Lead_Capture_Scans (1:N) - attendees who scanned badge
```

**Many-to-Many Relationships (junction tables needed):**
```
[YOUR ANSWER HERE]

Example:
  1. Speakers ↔ Sessions (many-to-many via Session_Speakers junction) - Co-presented sessions
  2. Attendees ↔ Sessions (many-to-many via Session_Attendance junction) - Session registration
  3. Events ↔ Content_Tracks (many-to-many via Event_Tracks junction) - Events can have multiple tracks
```

---

### **Q19: Are there TIME-SERIES entities?**

**Select type:**
- [ ] Transactions (badge scans, session attendance)
- [ ] Audit logs (state transitions, who changed what when)
- [ ] Metrics (daily registration counts, hourly task completion)
- [ ] None

**Your Answer:**
```
[YOUR ANSWER HERE]

Example:
Time-Series Entity 1: Lead_Capture_Scans
  - Purpose: Log every badge scan at exhibitor booth or session
  - Volume: 10K scans per event × 50 events/year = 500K rows/year
  - Retention: 1 year (purge after for GDPR compliance)
  - Fields: Scan_ID, Session_ID, Booth_ID, Attendee_ID, Scan_Timestamp, Scan_Location (GPS coords), Device_ID

Time-Series Entity 2: Proposal_State_Transitions
  - Purpose: Audit log of proposal state changes (who moved it from Submitted → Under Review, when)
  - Volume: 2000 proposals × 5 state changes average = 10K rows/year
  - Retention: 3 years (audit trail)
  - Fields: Transition_ID, Proposal_ID, From_State, To_State, Changed_By_User_ID, Changed_At_Timestamp, Change_Reason

Time-Series Entity 3: Event_Day_Tasks
  - Purpose: Butler pattern task queue (create, assign, complete in real-time)
  - Volume: 50 tasks per event × 50 events = 2500 rows/year
  - Retention: 1 year
  - Fields: Task_ID, Event_ID, Task_Title, Assigned_To_User_ID, Created_At, Due_At, Completed_At, Escalated (boolean)
```

**How long do we retain time-series data?**
```
[YOUR ANSWER HERE]

Example: "Lead scans: 1 year (GDPR right to deletion). Audit logs: 3 years (compliance). Task logs: 1 year (operational review)."
```

---

### **Q20: What's the data volume forecast?**

**Year 1 Projections:**
```
[YOUR ANSWER HERE]

Example:
Year 1 (First 12 months):
  - 50 events
  - 2000 proposals
  - 500 unique speakers
  - 2000 sessions (40 per event average)
  - 1000 booth reservations
  - 10K attendee registrations
  - 500K lead capture scans
  - Database size estimate: 2 GB
```

**Year 3 Projections:**
```
[YOUR ANSWER HERE]

Example:
Year 3 (Growth trajectory):
  - 500 events (10x growth)
  - 20K proposals (10x growth)
  - 5000 unique speakers (10x growth)
  - 20K sessions
  - 10K booth reservations
  - 100K attendee registrations
  - 5M lead capture scans
  - Database size estimate: 50 GB
```

---

## 🔄 PHASE 5: WORKFLOWS & STATE MACHINES (6 Questions)

### **State: WORKFLOW_DEFINITION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

---

### **Q21: What are the 3-5 CRITICAL workflows?**

**Workflow 1:**
```
Name: [e.g., Proposal Lifecycle]
Start State: [e.g., Draft]
End State: [e.g., Event Complete]
Estimated Duration: [e.g., 90 days from submission to event]
Orchestration Type: [ ] MAESTRO (state machine)  [ ] Butler (task queue)  [ ] Simple (no orchestration)

Example:
Name: Proposal Submission & Review Lifecycle
Start State: Draft
End State: Event Complete (or Rejected)
Estimated Duration: 90 days (submission to event date)
Orchestration Type: MAESTRO (state machine with notifications, escalations)
```

**Workflow 2:**
```
[REPEAT FORMAT]

Example:
Name: Event Day Task Coordination
Start State: Task Created
End State: Task Closed
Estimated Duration: 2 hours average (event day firefighting)
Orchestration Type: Butler (real-time task queue with escalation)
```

**Workflow 3-5:**
```
[REPEAT FORMAT]
```

---

### **Q22: For EACH workflow, what are the STATES?**

**Workflow 1 States:**
```
Workflow: [Name from Q21]
State 1: [Name] - [Description] - [Is this an entry state? Y/N] - [Is this a terminal state? Y/N]
State 2: [Name] - [Description] - ...
...

Example:
Workflow: Proposal Submission & Review Lifecycle
State 1: Draft - Speaker is writing proposal, not yet submitted - Entry State: Y - Terminal: N
State 2: Submitted - Proposal submitted, waiting for reviewer assignment - Entry State: N - Terminal: N
State 3: Under Review - Assigned to reviewers, waiting for scores - Entry State: N - Terminal: N
State 4: Scoring Complete - All reviews submitted, waiting for organizer decision - Entry State: N - Terminal: N
State 5: Accepted - Organizer approved proposal, waiting for speaker confirmation - Entry State: N - Terminal: N
State 6: Rejected - Organizer declined proposal - Entry State: N - Terminal: Y
State 7: Confirmed - Speaker confirmed participation, slides pending - Entry State: N - Terminal: N
State 8: Slides Due - Reminder sent, waiting for slide upload - Entry State: N - Terminal: N
State 9: Slides Approved - Slides reviewed and approved by organizer - Entry State: N - Terminal: N
State 10: Event Complete - Session delivered, post-event lead capture available - Entry State: N - Terminal: Y
```

**Workflow 2 States:**
```
[REPEAT FORMAT]
```

---

### **Q23: What TRIGGERS state transitions?**

**For each workflow, list triggers:**

**Workflow 1 Triggers:**
```
Workflow: [Name]
Transition: [From State] → [To State]
Trigger Type: [ ] User action (button click)  [ ] Time-based (deadline)  [ ] System event  [ ] External signal
Trigger Details: [Specific action/condition]

Example:
Workflow: Proposal Lifecycle
1. Draft → Submitted
   Trigger Type: User action
   Trigger Details: Speaker clicks "Submit Proposal" button (validation: title, abstract, bio all filled)

2. Submitted → Under Review
   Trigger Type: User action
   Trigger Details: Event Admin clicks "Assign Reviewers" button, selects 3 reviewers from dropdown

3. Under Review → Scoring Complete
   Trigger Type: System event
   Trigger Details: All assigned reviewers submit scores (auto-transition when 3/3 complete)

4. Scoring Complete → Accepted
   Trigger Type: User action
   Trigger Details: Event Admin clicks "Accept" button (only if average score >= 7/10)

5. Accepted → Confirmed
   Trigger Type: User action
   Trigger Details: Speaker clicks "Confirm Participation" button (sent via email link)

6. Accepted → Rejected (timeout)
   Trigger Type: Time-based
   Trigger Details: Speaker does not confirm within 14 days (auto-reject, proposal goes to Waitlist pool)

7. Confirmed → Slides Due
   Trigger Type: Time-based
   Trigger Details: 30 days before event, auto-send reminder email

8. Slides Due → Slides Approved
   Trigger Type: User action
   Trigger Details: Event Admin clicks "Approve Slides" after reviewing PDF upload

9. Slides Approved → Event Complete
   Trigger Type: Time-based
   Trigger Details: Event end date passes (auto-transition day after event)
```

**Workflow 2 Triggers:**
```
[REPEAT FORMAT]
```

---

### **Q24: Who can PERFORM each state transition?**

**For each workflow, list authorization rules:**

**Workflow 1 Authorization:**
```
Workflow: [Name]
Transition: [From State] → [To State]
Authorized Roles: [Which user roles can trigger this transition]
Authorization Logic: [Any additional rules beyond role check]

Example:
Workflow: Proposal Lifecycle
1. Draft → Submitted: Speaker (owner of proposal only, not other speakers)
2. Submitted → Under Review: Event Admin (for this specific event only, not other events)
3. Under Review → Scoring Complete: System (automatic when all reviews in)
4. Scoring Complete → Accepted: Event Admin (for this event only)
5. Scoring Complete → Rejected: Event Admin (for this event only)
6. Accepted → Confirmed: Speaker (owner of proposal only)
7. Confirmed → Slides Due: System (automatic time-based trigger)
8. Slides Due → Slides Approved: Event Admin (for this event only)
9. Slides Approved → Event Complete: System (automatic time-based trigger)

Special rules:
  - Super Admin can perform ANY transition (override for support escalations)
  - Reviewers can ONLY submit scores, cannot transition states
  - Speakers can only transition THEIR proposals, not other speakers' proposals
```

**Workflow 2 Authorization:**
```
[REPEAT FORMAT]
```

---

### **Q25: What NOTIFICATIONS fire on state transitions?**

**For each workflow, list notification rules:**

**Workflow 1 Notifications:**
```
Workflow: [Name]
Transition: [From State] → [To State]
Notify Who: [Which user/role receives notification]
Notification Channel: [ ] Email  [ ] SMS  [ ] In-app alert  [ ] Webhook
Notification Template: [Brief description of message content]

Example:
Workflow: Proposal Lifecycle
1. Draft → Submitted
   Notify Who: Event Admin (organizer of this event)
   Channel: Email + In-app alert
   Template: "New proposal submitted: '[Proposal Title]' by [Speaker Name]. Review deadline: [CFP Close Date]."

2. Submitted → Under Review
   Notify Who: Assigned reviewers (3 reviewers)
   Channel: Email
   Template: "You have been assigned to review proposal '[Proposal Title]'. Please submit scores by [Review Deadline - 7 days]."

3. Under Review → Scoring Complete
   Notify Who: Event Admin
   Channel: In-app alert
   Template: "All reviews complete for '[Proposal Title]'. Average score: [X.X/10]. Action required: Accept/Reject."

4. Scoring Complete → Accepted
   Notify Who: Speaker (proposal owner)
   Channel: Email
   Template: "Congratulations! Your proposal '[Proposal Title]' has been accepted for [Event Name]. Please confirm participation by [Deadline - 14 days]."

5. Scoring Complete → Rejected
   Notify Who: Speaker (proposal owner)
   Channel: Email
   Template: "Thank you for submitting '[Proposal Title]' to [Event Name]. Unfortunately, we are unable to include your session this year. We encourage you to submit to future events."

6. Accepted → Confirmed
   Notify Who: Event Admin
   Channel: In-app alert
   Template: "[Speaker Name] confirmed participation for '[Proposal Title]'. No action required."

7. Accepted → Rejected (timeout)
   Notify Who: Speaker (reminder) + Event Admin (escalation)
   Channel: Email (both)
   Template (Speaker): "Reminder: Please confirm participation for '[Proposal Title]' by [Deadline - 2 days remaining]."
   Template (Admin): "No response from [Speaker Name] for '[Proposal Title]'. Auto-reject in 2 days."

8. Confirmed → Slides Due
   Notify Who: Speaker
   Channel: Email
   Template: "Slides due for '[Proposal Title]' at [Event Name]. Please upload by [Deadline - 14 days before event]. Upload link: [URL]."

9. Slides Due → Slides Approved
   Notify Who: Speaker
   Channel: Email
   Template: "Your slides for '[Proposal Title]' have been approved. See you at [Event Name] on [Event Date]!"

10. Slides Approved → Event Complete
    Notify Who: Speaker
    Channel: Email
    Template: "Thank you for presenting at [Event Name]! View your lead capture dashboard: [URL]."
```

**Workflow 2 Notifications:**
```
[REPEAT FORMAT]
```

---

### **Q26: Are there ESCALATION rules?**

**For each workflow, list escalation logic:**

**Workflow 1 Escalations:**
```
Workflow: [Name]
Entity sits in [State] for [X days] with no action → Escalate to [Who] via [Channel]

Example:
Workflow: Proposal Lifecycle
1. Under Review for 7 days with <50% reviews complete → Email Event Admin: "5 proposals need reviewer attention. Reviewers [Names] have not submitted scores."

2. Under Review for 14 days with <50% reviews complete → Email Super Admin + Event Admin: "Escalation: Review cycle behind schedule. [N] proposals blocked."

3. Accepted for 7 days with no speaker confirmation → Email Speaker (reminder): "Please confirm participation for '[Proposal Title]' by [Deadline]."

4. Accepted for 12 days with no speaker confirmation → Email Event Admin: "No response from [Speaker Name]. Consider rejecting and promoting Waitlist proposal."

5. Slides Due for 7 days past deadline with no upload → Email Speaker (urgent reminder) + Event Admin (escalation): "Slides overdue for '[Proposal Title]'. Event in [X] days."

6. Slides Approved for 3 days with no review → Email Event Admin: "Slides pending approval for '[Proposal Title]'. Event in [X] days."
```

**Workflow 2 Escalations:**
```
[REPEAT FORMAT]
```

---

## 🖥️ PHASE 6: UI & INTERACTION PATTERNS (6 Questions)

### **State: UI_DEFINITION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

---

### **Q27: What are the 5-10 PRIMARY screens/tabs?**

**Screen 1:**
```
Tab Name: [e.g., Event Master Registry]
Primary User: [Which persona from Q11]
Pattern: [ ] CRUD grid  [ ] Kanban board  [ ] Calendar view  [ ] Master/Detail  [ ] Dashboard  [ ] Custom
Data Source: [Which entity from Q16]
Key Actions: [Create, Edit, Delete, Export, etc.]

Example:
Tab Name: Event Master Registry
Primary User: Conference Organizer
Pattern: CRUD grid (MUI DataGrid Pro)
Data Source: Event_Master
Key Actions: Create event, Edit details, Clone previous event, Export to CSV, Filter by date range/city
```

**Screen 2:**
```
[REPEAT FORMAT]

Example:
Tab Name: Proposal Inbox (Kanban Board)
Primary User: Conference Organizer
Pattern: Kanban board (columns = states, drag cards to transition)
Data Source: Proposal_Submissions
Key Actions: Drag proposal between states, View proposal detail, Assign reviewers, Accept/Reject batch actions
```

**Screen 3-10:**
```
[REPEAT FORMAT FOR EACH PRIMARY SCREEN]

Example screens:
  3. Proposal Review Workbench (Master/Detail - split view)
  4. Speaker Management (CRUD grid)
  5. Session Scheduler (Calendar drag-and-drop)
  6. Event Day Command Center (Real-time dashboard)
  7. Booth Floor Plan Designer (Custom canvas + drag-and-drop)
  8. Lead Capture Dashboard (Dashboard with charts)
  9. Attendee Registration (CRUD grid with payment widget)
  10. My Proposals (Speaker Portal - Kanban board)
```

---

### **Q28: For Kanban/Calendar/Custom patterns, describe interaction details**

**If you have Kanban boards:**
```
Kanban Board Name: [e.g., Proposal Inbox]
Columns (swim lanes): [List column names left to right]
Card Content: [What fields display on each card]
Drag Behavior: [What happens when user drags card from Column A to Column B]
Filters: [What filters appear above board]

Example:
Kanban Board Name: Proposal Inbox
Columns: Draft | Submitted | Under Review | Scoring Complete | Accepted | Rejected | Confirmed
Card Content: Proposal title, Speaker name, Average review score (if reviews complete), Days in current state
Drag Behavior: Dragging from "Submitted" to "Under Review" → Opens "Assign Reviewers" dialog (select 3 reviewers, click Confirm) → State transitions + notifications sent
Filters: Filter by event (dropdown), Filter by track (multi-select), Search by speaker name or proposal title
```

**If you have Calendar views:**
```
[DESCRIBE CALENDAR INTERACTION]

Example:
Calendar Name: Session Scheduler
View Options: Day view (for event day) | Week view | Month view (for multi-day events)
Event Blocks: Each session = colored block (color = track), shows session title, speaker name, room number, expected attendance
Drag Behavior: Drag session block to new time slot → Conflict detection (room double-booked? speaker double-booked?) → Confirm or cancel
Click Behavior: Click session block → Opens detail modal (edit time, room, speaker, description)
```

**If you have Custom patterns:**
```
[DESCRIBE CUSTOM INTERACTION]

Example:
Custom Pattern: Booth Floor Plan Designer
Canvas: SVG grid (100x100 units = expo hall dimensions), zoom in/out, pan
Booth Objects: Rectangle shapes (10x10, 10x20, 20x20 sizes), draggable, snap to grid
Interaction: 1) Select booth size from palette, 2) Drag onto canvas, 3) Double-click to assign exhibitor (dropdown), 4) Color-code by exhibitor status (reserved = yellow, paid = green, available = gray)
Export: Export floor plan to PDF with exhibitor names, booth numbers, fire exits
```

---

### **Q29: What are the 3-5 KEY reports/dashboards?**

**Dashboard 1:**
```
Dashboard Name: [e.g., Event Planner Dashboard]
Target User: [Which persona]
Refresh Frequency: [ ] Real-time (WebSocket)  [ ] 30-second poll  [ ] Manual refresh  [ ] Static (daily snapshot)
Widgets (list 5-7):
  1. [Widget Name] - [Chart Type] - [Purpose]
  2. [Widget Name] - [Chart Type] - [Purpose]
  ...

Example:
Dashboard Name: Event Planner Dashboard
Target User: Conference Organizer
Refresh Frequency: 30-second poll (during event registration window), Manual refresh (during planning phase)
Widgets:
  1. Proposal Funnel - Bar chart (stacked bars by state) - Track proposal pipeline health
  2. Registration Curve - Line chart (actual vs. target) - Forecast attendance, adjust marketing
  3. Task Alerts - Color-coded list (red/yellow/green) - Event day firefighting priority queue
  4. Budget Tracker - Gauge chart (% spent vs. forecast) - Financial health check
  5. Reviewer Completion Status - Progress bars (% per reviewer) - Chase slow reviewers
  6. Top Session Scores - Ranked list (proposals sorted by avg score) - Identify must-have sessions
  7. Speaker Confirmation Status - Pie chart (confirmed / pending / no response) - Track speaker commitment

Export: CSV (proposal list with scores), PDF (executive summary for board meeting), PowerPoint (agenda slides with branding)
```

**Dashboard 2:**
```
[REPEAT FORMAT]

Example:
Dashboard Name: Event Day Command Center
Target User: Event Logistics Coordinator
Refresh Frequency: 5-second poll (real-time during event)
Widgets:
  1. Live Session Attendance - Heat map (rooms color-coded by capacity %) - Identify overcrowded rooms, reallocate
  2. Task Queue - Kanban board (Created / Assigned / In Progress / Blocked / Resolved) - Real-time firefighting
  3. Incident Log - Timeline (AV failures, speaker no-shows, medical emergencies) - Audit trail
  4. Shuttle Tracker - Map view (shuttle GPS pins, next arrival times) - Attendee coordination
  5. Speaker Check-In Status - List (checked in = green, not checked in = red) - Proactive outreach if speaker missing 30 min before session
  6. Room Status - Grid (occupied / available / needs cleaning) - Janitorial coordination

Export: PDF (end-of-day incident report), CSV (task log for post-event review)
```

**Dashboard 3-5:**
```
[REPEAT FORMAT]
```

---

### **Q30: Are there REAL-TIME requirements?**

**Select approach for each real-time feature:**

**Feature 1:**
```
Feature: [e.g., Event Day Command Center - Task Queue]
Update Frequency: [ ] Real-time (WebSocket <1 sec)  [ ] Near-real-time (5-sec poll)  [ ] Periodic (30-sec poll)  [ ] Static (manual refresh)
Why this frequency: [Business justification]

Example:
Feature: Event Day Command Center - Task Queue
Update Frequency: Near-real-time (5-second poll)
Why: Event day firefighting requires fast response (AV failure, speaker no-show). 5-second poll balances responsiveness with server load (50 concurrent coordinators × 0.2 req/sec = 10 req/sec manageable). WebSocket overkill for this use case.
```

**Feature 2:**
```
[REPEAT FORMAT]

Example:
Feature: Proposal Inbox Kanban Board
Update Frequency: Periodic (30-second poll)
Why: Multiple organizers may edit proposals simultaneously. 30-second refresh prevents stale data conflicts without overwhelming server. Not critical path (no one is firefighting proposals).
```

**Feature 3:**
```
[REPEAT FORMAT IF NEEDED]
```

---

### **Q31: What's the MOBILE vs. DESKTOP split?**

**For each persona, specify device preference:**

**Persona 1 Device Preference:**
```
Persona: [Name from Q11]
Primary Device: [ ] Desktop-only  [ ] Mobile-first  [ ] Responsive (both)
Justification: [Why this device pattern]
Mobile Screens (if applicable): [Which screens MUST work on mobile]
Desktop-Only Screens: [Which screens are desktop-only]

Example:
Persona: Conference Organizer
Primary Device: Desktop-only
Justification: Complex workflows (assign reviewers, edit event details, review proposals). Large grids, multi-column layouts, requires 24"+ monitor. Organizers work from office desk, not mobile.
Mobile Screens: Event list (read-only view), Task alerts (read/acknowledge)
Desktop-Only Screens: Proposal review workbench, Session scheduler, Booth floor plan designer
```

**Persona 2 Device Preference:**
```
[REPEAT FORMAT]

Example:
Persona: Event Logistics Coordinator
Primary Device: Mobile-first (iPad during event day)
Justification: Event day coordination requires mobility (walking expo floor, backstage, registration desk). Task queue must be accessible on iPad in portrait mode.
Mobile Screens: Event Day Command Center, Task Queue, Speaker Check-In List, Incident Log
Desktop-Only Screens: Pre-event planning (calendar, budget tracker)
```

**Persona 3-5 Device Preference:**
```
[REPEAT FORMAT]
```

---

### **Q32: Are there PRINT/EXPORT requirements?**

**List all export/print needs:**

**Export 1:**
```
From Screen: [Screen name from Q27]
Export Format: [ ] CSV  [ ] PDF  [ ] PowerPoint  [ ] Excel  [ ] JSON (API)  [ ] iCal
Purpose: [Why user needs this export]
Frequency: [ ] Daily  [ ] Weekly  [ ] Event-driven  [ ] Ad-hoc

Example:
From Screen: Proposal Inbox
Export Format: CSV
Purpose: Event admin exports proposal list with reviewer scores to Excel for offline analysis, board presentation preparation
Frequency: Ad-hoc (export button in toolbar)
```

**Export 2:**
```
[REPEAT FORMAT]

Example:
From Screen: Event Planner Dashboard
Export Format: PowerPoint
Purpose: Auto-generate agenda slides with event branding (logo, colors) for distribution to attendees, sponsors
Frequency: Event-driven (once agenda finalized, 30 days before event)
Template: Use PowerPoint template stored in Azure Blob (upload via admin settings), populate with session titles, speakers, times, room numbers
```

**Export 3-5:**
```
[REPEAT FORMAT]

Example exports:
  3. Lead Capture Dashboard → CSV → Export leads to Salesforce (post-event)
  4. Speaker Portal → iCal → Sync speaking calendar to Outlook/Google Calendar
  5. Event Day Command Center → PDF → End-of-day incident report for post-event debrief
```

---

## 🔌 PHASE 7: TECHNICAL CONSTRAINTS & INTEGRATIONS (6 Questions)

### **State: TECHNICAL_DEFINITION**
**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

---

### **Q33: Data volume and performance expectations (DETAILED)**

**Already captured in Q10, but add any additional performance SLAs:**

```
[YOUR ANSWER HERE]

Example additions:
  - P95 latency for dashboard load: <3 seconds (95% of requests complete in 3 sec or less)
  - Concurrent write operations: 100 proposals submitted simultaneously during CFP deadline (load test for 100 concurrent POST requests)
  - Database query timeout: 5 seconds max (abort and show error if query takes longer)
  - File upload size limit: 50 MB per presentation slide deck (enforce in UI + backend)
  - API rate limit: 100 requests per minute per user (prevent abuse, throttle if exceeded)
```

---

### **Q34: Compliance requirements (DETAILED)**

**Already captured in Q9, but add any additional compliance details:**

```
[YOUR ANSWER HERE]

Example additions:
GDPR Compliance:
  - Consent tracking: Checkbox on attendee registration form ("I consent to my data being shared with sponsors for lead capture purposes")
  - Right to deletion: "Delete My Data" button in user profile → Soft delete (flag as deleted, anonymize PII fields, retain for 30 days, hard delete after)
  - Data export: "Download My Data" button → Generate JSON file with all user data (proposals, registrations, lead scans)
  - Data retention: Attendee data purged 1 year after event (unless user opts in to marketing list)

PCI-DSS Compliance:
  - Payment processing: Embed Stripe widget (iframe), never store credit card numbers in our database
  - Stripe handles: Card tokenization, PCI compliance, dispute resolution
  - We store: Stripe customer ID, transaction ID (for refund lookup), payment status (paid/pending/refunded)

Accessibility (WCAG 2.1 Level AA):
  - Color contrast: 4.5:1 minimum for text
  - Keyboard navigation: All forms, buttons, grids accessible via Tab key
  - Screen reader support: ARIA labels on all interactive elements
  - Alt text: Required on all uploaded images (speaker headshots, event logos)
```

---

### **Q35: External system integration details (DETAILED)**

**Already captured in Q8 and Q17, but add technical specs:**

**Integration 1 Technical Specs:**
```
System: [Name from Q8/Q17]
Integration Method: [ ] REST API  [ ] GraphQL  [ ] Webhook  [ ] CSV file upload  [ ] Database direct connection
Authentication: [ ] OAuth 2.0  [ ] API key  [ ] Basic auth  [ ] JWT token
API Endpoint: [URL or describe]
Data Format: [ ] JSON  [ ] XML  [ ] CSV
Error Handling: [What happens if integration fails]

Example:
System: Salesforce
Integration Method: REST API
Authentication: OAuth 2.0 (user authorizes via "Connect Salesforce" button, we store refresh token)
API Endpoint: https://[instance].salesforce.com/services/data/v58.0/sobjects/Lead/
Data Format: JSON
Mapping:
  - Lead_Capture_Scans.Attendee_Name → Salesforce.Lead.Name
  - Lead_Capture_Scans.Attendee_Email → Salesforce.Lead.Email
  - Lead_Capture_Scans.Attendee_Company → Salesforce.Lead.Company
  - Lead_Capture_Scans.Scan_Timestamp → Salesforce.Lead.Custom_Field__Lead_Captured_Date
  - Lead_Capture_Scans.Session_Name → Salesforce.Lead.Description
  - Lead_Capture_Scans.Lead_Score (hot/warm/cold) → Salesforce.Lead.Rating
Error Handling: If Salesforce API returns 429 (rate limit), retry with exponential backoff (1 sec, 2 sec, 4 sec). If 401 (auth expired), prompt user to re-authorize. If 500 (server error), log error and send email to admin.
Frequency: On-demand (exhibitor clicks "Export Leads to Salesforce" button post-event)
```

**Integration 2 Technical Specs:**
```
[REPEAT FORMAT]

Example:
System: Mailchimp
Integration Method: REST API
Authentication: API key (admin enters in settings page)
API Endpoint: https://[dc].api.mailchimp.com/3.0/campaigns
Data Format: JSON
Use Cases:
  1. Send session reminder emails (3 days before event) → Use Mailchimp campaign template
  2. Send post-event survey (1 day after event) → Use Mailchimp automation workflow
Mapping:
  - Attendee_Registrations.Email → Mailchimp.List.Members.Email
  - Attendee_Registrations.First_Name → Mailchimp.Merge_Fields.FNAME
  - Attendee_Registrations.Last_Name → Mailchimp.Merge_Fields.LNAME
  - Session_Schedule.Session_Title → Mailchimp.Merge_Fields.SESSION_NAME
  - Event_Master.Event_Date → Mailchimp.Merge_Fields.EVENT_DATE
Error Handling: If Mailchimp API fails, log error and retry in 1 hour. If still failing after 3 retries, email admin with "Mailchimp integration broken" alert.
Frequency: Scheduled (cron job runs daily at 8am to send next day's session reminders)
```

**Integration 3-5 Technical Specs:**
```
[REPEAT FORMAT]
```

---

### **Q36: Existing data sources to import (migration)**

**List legacy data that needs migration:**

**Legacy Data Source 1:**
```
Source: [e.g., Excel spreadsheet, old CRM, Google Sheets]
Data Type: [What entities does this contain]
Volume: [How many rows]
Migration Strategy: [ ] One-time bulk import  [ ] Ongoing sync  [ ] Manual copy/paste
Data Quality: [Any data cleaning needed]

Example:
Source: Excel spreadsheet (5 years of past events)
Data Type: Events, Sessions, Speakers (no proposals - historical data only)
Volume: 250 events, 10K sessions, 2K speakers
Migration Strategy: One-time bulk import (CSV upload via admin tool)
Data Quality:
  - Issue 1: Speaker names inconsistent (John Smith vs. J. Smith vs. Smith, John) - Need fuzzy match + manual review
  - Issue 2: Missing speaker emails (50% null) - Import as-is, prompt speakers to claim profiles
  - Issue 3: Date formats inconsistent (MM/DD/YYYY vs. DD/MM/YYYY) - Normalize during import
  - Issue 4: Venue names vary (McCormick Place vs. McCormick vs. MCP) - Create venue lookup table, deduplicate
Validation: Import to staging database first, run data quality report, admin reviews and approves before production import
```

**Legacy Data Source 2:**
```
[REPEAT FORMAT IF APPLICABLE]
```

---

### **Q37: Deployment model (DETAILED)**

**Already captured in Q38 (below), but add infrastructure details:**

```
[YOUR ANSWER HERE]

Example:
Deployment Model: Multi-tenant SaaS with TTP_ID isolation
Infrastructure:
  - Frontend: Azure Static Web Apps (React + Vite build)
  - Backend: Azure VM (Python FastAPI on Ubuntu, Gunicorn WSGI server, Nginx reverse proxy)
  - Database: Azure SQL Database (Business Critical tier, 4 vCores, 1 TB storage)
  - File Storage: Azure Blob Storage (presentation slides, speaker headshots, event logos)
  - CDN: Azure CDN (static assets - images, CSS, JS)
  - DNS: Azure DNS (custom domain - events.techgacity.com)

Multi-Tenancy Strategy:
  - TTP_ID on every table (Organization_Master.TTP_ID = tenant identifier)
  - Row-level security: All queries filtered by TTP_ID (enforced in stored procedures, NOT application code)
  - Shared database: All customers in same database (cost-efficient), isolated by TTP_ID
  - Shared reference data: Event types, session formats, industries (no TTP_ID, globally visible)
  - Custom branding: Logo, colors stored in Organization_Master, applied via MUI theme overrides

Scaling Strategy:
  - Horizontal: Add more FastAPI worker processes (Gunicorn workers), load balance via Nginx
  - Vertical: Increase VM size (2 vCores → 4 vCores) when concurrent users >500
  - Database: Auto-scaling enabled (Azure SQL elastic pool), max 10 vCores
  - CDN: Azure CDN auto-scales (no manual intervention)

Backup/DR:
  - Database: Daily automated backups (7-day retention), point-in-time restore to 5 minutes ago
  - File Storage: Geo-redundant (LRS → GRS), replicated to secondary region
  - Disaster Recovery: RTO (Recovery Time Objective) = 4 hours, RPO (Recovery Point Objective) = 5 minutes
```

---

### **Q38: Licensing and cost constraints (DETAILED)**

**Already captured in Q9, but add cost breakdown:**

```
[YOUR ANSWER HERE]

Example:
Total Budget: $50K for MVP (4 weeks development)

Cost Breakdown:
1. Development Labor: $40K (160 hours × $250/hr blended rate)
2. Azure Infrastructure (Year 1): $5K
   - Static Web Apps: $0 (free tier)
   - VM (B2s - 2 vCores, 4 GB RAM): $60/month × 12 = $720/year
   - Azure SQL (Business Critical, 4 vCores): $2500/month × 12 = $30K/year (OUCH - consider downgrade to Standard tier $300/month = $3600/year for MVP)
   - Blob Storage: $50/year (100 GB)
   - CDN: $100/year (1 TB egress)
   - DNS: $5/year
3. Third-Party Services (Year 1): $1K
   - MUI DataGrid Pro: $249/year (already owned)
   - Stripe: 2.9% + $0.30 per transaction (variable, estimated $500/year for 1K transactions)
   - Mailchimp: $20/month × 12 = $240/year (Essentials plan, 500 contacts)
4. Contingency: $4K (10% buffer for unforeseen costs)

Cost Optimization Strategies:
  - Downgrade Azure SQL from Business Critical ($30K/year) to Standard S3 ($300/month = $3600/year) for MVP - Monitor performance, upgrade if needed
  - Use free tier for Azure Static Web Apps (no custom domain required for MVP)
  - Use Azure Functions instead of VM for backend (serverless, pay-per-execution) - Cost estimate: $50/month = $600/year (cheaper than VM)

Pricing Model (Revenue):
  - Per-event pricing: $500/event for organizers (includes unlimited proposals, speakers, exhibitors, attendees)
  - Break-even: 10 events/month × $500 = $5K/month revenue → covers $5K/month infrastructure + support
  - Target: 50 events/month × $500 = $25K/month revenue (Year 1) → $300K ARR
```

---

## ✅ DISCOVERY COMPLETE - READY FOR BLUEPRINT SYNTHESIS

**Agent Final Validation Checklist:**

Before generating blueprint, confirm you have answered:
- [ ] 38 core questions across 7 phases
- [ ] At least 3 clarifying questions (Q6, Q13, Q16) with detailed answers
- [ ] At least 1 workflow fully defined (states, triggers, authorization, notifications, escalations)
- [ ] At least 3 user personas with workflows and dashboards
- [ ] At least 5 core entities with field definitions and relationships
- [ ] At least 3 UI screens with interaction patterns
- [ ] At least 1 integration with technical specs
- [ ] Success metric defined with measurement approach

**If all boxes checked, you are ready to attach this document to agent with message:**

---

## 📎 SUBMIT TO AGENT

**Copy/paste this message when attaching this document to agent:**

```
I've completed the discovery input template for [SOLUTION NAME]. 

Please process this document and generate:
1. Complete blueprint (Phase 1: Requirements, Phase 2: Architecture, Phase 3: Technical Debt Assessment)
2. Database schema (tables, views, stored procedures)
3. Backend API endpoints
4. Frontend UI component structure (screens, tabs, dashboards)
5. Workflow state machines (MAESTRO orchestration)
6. Development task list (MVP + full suite estimates)

Discovery completion: [X/38] questions answered, [X/7] phases complete.

Proceed to architecture synthesis. Thank you!
```

---

**END OF DISCOVERY INPUT TEMPLATE**

---

## 🎤 ALTERNATIVE INPUT FORMAT: VOICE TRANSCRIPT

**If you recorded voice answers instead of filling out form, paste transcript below:**

```
## VOICE TRANSCRIPT

[PASTE TRANSCRIPT HERE]

Example:
"OK so here's what I need to build. I was at a conference last month and the proposal process was insane. Like 40 different steps, no visibility into where my proposal was, and when I finally got accepted, I had to coordinate travel, slides, booth setup all in different systems. It was chaos.

So the main stakeholder is conference organizers. They're spending like 200 hours per event just coordinating everything. If we can save them 60% of that time, they'll absolutely pay for this.

The current process is... let me walk through it. Day 1, they research events in a spreadsheet. Day 30, they define tracks. Day 60, they launch the call for proposals using Google Forms. Then they get like 200 proposals and have to manually assign them to reviewers via email. Then they chase the reviewers for weeks because nobody responds. Then they score everything in Excel, send acceptance letters via mail merge, track confirmations in another spreadsheet, create the agenda in PowerPoint which takes forever...

[CONTINUE FOR 10-15 MINUTES COVERING ALL KEY TOPICS]

So yeah, that's basically what I need. Let me know if you have questions."
```

**Agent will parse this transcript and ask clarifying questions for any gaps before generating blueprint.**

---

## 📚 ALTERNATIVE INPUT FORMAT: CONTEXT DOCUMENTS

**If you have existing requirements docs, meeting notes, customer interviews, paste below:**

```
## CONTEXT DOCUMENTS

### Document 1: Customer Interview Transcript (March 2026)
[PASTE DOCUMENT]

### Document 2: Requirements Brainstorm (May 2026)
[PASTE DOCUMENT]

### Document 3: Competitive Analysis
[PASTE DOCUMENT]
```

**Agent will extract discovery answers from these documents and fill gaps with clarifying questions.**

---

## 🧠 ALTERNATIVE INPUT FORMAT: BRAIN DUMP

**If you just want to stream-of-consciousness write about the solution, do it below:**

```
## BRAIN DUMP

[START WRITING, DON'T WORRY ABOUT STRUCTURE]

Example:
"So here's the idea. Conferences are a mess. I went to submit a speaker proposal and it was like 40 steps across 10 different systems. No idea where my proposal was in the review process. Then when I got accepted I had to scramble to book travel and coordinate with the exhibitor team and there was no central place to manage all this.

And it's not just me - conference organizers are spending 200 hours per event doing all this coordination manually. Assigning proposals to reviewers, chasing feedback, creating the agenda, managing the event day logistics. 

I'm thinking we need like a Kanban board for proposals. Columns for each state - draft, submitted, under review, accepted, etc. You drag a proposal from submitted to under review and it auto-assigns reviewers and sends them emails. Then when all the reviews are in it auto-moves to the next state.

And then for event day we need like a real-time command center. Tasks popping up - AV failure in Room B, speaker hasn't checked in 30 minutes before session, shuttle is late. Butler pattern where tasks escalate if they sit too long.

And post-event we need to capture leads. Badge scans at exhibitor booths, export to Salesforce with hot/warm/cold scoring...

[CONTINUE STREAM OF CONSCIOUSNESS FOR 15-20 MINUTES]"
```

**Agent will parse this brain dump, organize into discovery categories, ask clarifying questions for gaps, then generate blueprint.**

---

**Document Status:** ✅ DISCOVERY INPUT TEMPLATE COMPLETE  
**Usage:** Copy entire document, fill in answers, attach to agent chat for blueprint generation  
**Alternative Formats:** Voice transcript, context documents, brain dump (all accepted)
