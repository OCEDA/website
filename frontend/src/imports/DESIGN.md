# OCEDA Design System & UI/UX Specification

## 1. Project Overview

OCEDA is an AI-assisted otoendoscopy system designed to support non-specialist healthcare workers in examining and assessing the ear canal.

The system consists of three interconnected components:

1. **Physical Otoendoscope Device**

   * Captures ear canal images.
   * Uses an Arducam 8MP Sony IMX219 V2 camera on a Raspberry Pi Zero W.
   * Includes a physical capture button.
   * Transmits captured images to the backend or local processing infrastructure.

2. **OCEDA Web Application**

   * Used by healthcare workers.
   * Handles patient information.
   * Receives captured images from the physical device.
   * Allows users to review and select a capture.
   * Sends the selected image for AI analysis.
   * Displays the AI classification, confidence score, and heatmap.
   * Communicates analysis results through the registered user's email.

3. **AI Processing Service**

   * Receives the selected ear canal image.
   * Performs AI classification.
   * Produces:

     * Normal / Abnormal classification
     * Confidence score
     * Heatmap / visual explanation
   * The processing infrastructure may run locally or remotely.
   * The UI must remain independent from the specific processing hardware.

---

# 2. Primary Design Goal

The OCEDA interface should make medical image examination feel:

* Simple
* Clear
* Trustworthy
* Professional
* Calm
* Modern
* Approachable

The primary user is a **non-ENT healthcare worker**, such as a general practitioner.

The interface should therefore avoid assuming specialist-level knowledge of medical imaging or AI.

The user should always understand:

1. What step they are currently on.
2. What information they are looking at.
3. What action they should take next.
4. Whether the device/system is working.
5. What the AI result means.

The interface should minimize unnecessary cognitive load.

---

# 3. Core Design Principles

## 3.1 Image First

The captured ear canal image is the most important visual element during examination.

Medical images must receive sufficient space and visual priority.

Do not allow decorative UI elements, excessive cards, or unnecessary controls to compete with the medical image.

## 3.2 Clear Next Action

Each examination step should have one obvious primary action.

Examples:

* `Start New Examination`
* `Choose This Capture`
* `Analyze This Capture`
* `Try Again`
* `Finish`

Primary actions should be visually distinct from secondary actions.

## 3.3 Clinical but Friendly

The visual language should feel medical and trustworthy without resembling a rigid hospital administration system.

Avoid:

* Excessive corporate styling
* Generic hospital ERP aesthetics
* Overly futuristic AI interfaces
* Excessive neon effects
* Excessive glassmorphism
* Excessive gradients
* Excessive decorative illustrations

The interface may use rounded components and warm accent colors to remain approachable.

## 3.4 Progressive Information

Do not display all available information at once.

Show the most important information first.

For example, an AI result should prioritize:

1. Classification
2. Confidence
3. Heatmap
4. Supporting information

Technical details should remain secondary.

## 3.5 Consistency

Buttons, cards, status indicators, spacing, typography, and navigation should behave consistently across all screens.

---

# 4. Critical System Constraints

These constraints are mandatory.

## 4.1 No Live Camera Preview

**The web application does NOT contain a live camera preview.**

The physical OCEDA device captures the image.

The web application receives the completed capture afterward.

Never create:

* Live webcam preview
* Browser camera interface
* Video stream
* Camera viewfinder
* Live camera controls

The web interface may show a waiting state while the physical device is being used.

## 4.2 No Video Recording

OCEDA currently focuses on still-image capture.

Do not add video recording controls.

## 4.3 No Persistent Medical Image Gallery

The web application is not intended to become a medical image archive.

Do not create:

* Image gallery
* Long-term examination history
* Medical image library
* Patient image timeline

Captured images may be temporarily processed during an examination.

## 4.4 Registered Email

Analysis results are sent to the authenticated healthcare worker's registered email.

Do not ask the user to manually enter an arbitrary email address during every examination.

## 4.5 Backend-Agnostic UI

Do not expose implementation-specific infrastructure in the main user interface.

Do not create Raspberry Pi management screens, ESP32 configuration dashboards, server monitoring pages, or similar technical controls.

The user should interact with the examination system, not its underlying infrastructure.

---

# 5. Core User Flow

## 5.1 Examination Setup

```text
Start
↓
Login
↓
Dashboard
↓
Start New Examination
↓
Enter / Confirm Patient Information
↓
Ready for Capture
```

## 5.2 Capture and Selection

```text
Ready for Capture
↓
Use Physical OCEDA Device
↓
Press Physical Capture Button
↓
Image Captured
↓
Image Transmitted to Backend
↓
Backend Receives Image
↓
Web App Receives Image
↓
Captures Ready
↓
Review Captures
↓
Browse Captures
↓
Select Capture
```

## 5.3 AI Analysis and Result

```text
Select Capture
↓
Analyze This Capture
↓
Send Selected Image to AI Processing Service
↓
AI Processing
↓
Classification + Confidence Score + Heatmap
↓
Display Result
↓
Send Original Image + Heatmap to Registered Email
↓
End
```

---

# 6. Examination States

The UI should clearly communicate the current system state.

## Device States

Supported states:

* Connected
* Connecting
* Disconnected
* Connection Failed

Example visual treatment:

**Connected**

* Small green status indicator
* Clear text such as `Device Connected`

**Connecting**

* Neutral/blue status indicator
* Loading indicator
* `Connecting to OCEDA device...`

**Disconnected**

* Warning status
* Clear explanation
* Suggested action

**Connection Failed**

* Error status
* Retry action

---

# 7. Capture States

The capture process may include:

* Waiting for capture
* Capturing
* Receiving image
* Image received
* Transmission failed
* Retry

The UI should explain what is happening instead of showing an unexplained loading spinner.

Example:

```text
Waiting for capture
Press the physical capture button on the OCEDA device.
```

During transmission:

```text
Receiving capture
Please wait while the image is being transferred.
```

---

# 8. Capture Review

The Capture Review screen is one of the most important screens in the application.

The user should be able to:

* View the captured image.
* Understand which capture is currently displayed.
* Navigate between captures.
* Select the preferred capture.
* Proceed to AI analysis.

Example information hierarchy:

```text
Capture 2 of 3

[ LARGE EAR CANAL IMAGE ]

< Previous                         Next >

[ Choose This Capture ]

Resolution: [received resolution]
```

The image should remain the visual focus.

Navigation controls should be large enough for touch interaction.

---

# 9. Image Presentation

Medical images must be displayed accurately.

## Requirements

* Preserve original aspect ratio.
* Avoid unnecessary cropping.
* Avoid distortion.
* Provide sufficient contrast against the surrounding UI.
* Keep image controls minimal.
* Ensure the image remains easy to inspect in both light and dark mode.

The interface may provide a contained image viewer, but decorative framing should not dominate the image.

---

# 10. AI Analysis

After the user selects a capture:

```text
Analyze This Capture
```

The system sends the selected image to the AI Processing Service.

During processing, clearly communicate:

```text
Analyzing capture...
```

Avoid showing unexplained technical terminology.

Do not imply that AI analysis is instantaneous if processing is still occurring.

---

# 11. AI Result

The result screen should clearly communicate the AI output.

Primary information:

### Classification

Possible classifications:

* `Normal`
* `Abnormal`

### Confidence Score

Display the confidence in an easy-to-understand format.

Example:

```text
Normal

92% confidence
```

### Heatmap

Display the original medical image with the AI heatmap.

The heatmap should help the healthcare worker understand the area that contributed to the model's output.

The heatmap should not completely obscure the original image.

Where appropriate, provide a clear distinction between:

* Original image
* AI heatmap visualization

---

# 12. Result Color Semantics

Use semantic colors carefully.

## Normal

Use a restrained green to communicate a positive/normal result.

Do not make green overly saturated or decorative.

## Abnormal

Use a restrained red or warm warning color.

The result should be noticeable without creating unnecessary alarm.

## Warning

Use amber/orange for system warnings or attention states.

## Primary Actions

Use the OCEDA primary blue.

## Secondary Accent

Use salmon/coral for selected secondary actions or important warm accents.

Semantic colors should not replace text labels.

---

# 13. Email Delivery

After successful analysis:

```text
Analysis Complete
```

The system sends:

* Original image
* AI heatmap
* Analysis result

to the authenticated healthcare worker's registered email.

Possible states:

### Sending

```text
Sending result to your registered email...
```

### Sent

```text
Result sent successfully.
```

### Failed

```text
We couldn't send the result email.
[ Try Again ]
```

Email delivery status should not prevent the user from understanding the AI result already displayed on screen.

---

# 14. Patient Information

The examination requires:

* Patient ID
* Patient Name

Keep the form simple.

Do not add unnecessary demographic fields unless they become explicitly required by the project.

Use clear labels rather than relying only on placeholder text.

Example:

```text
Patient ID
[________________]

Patient Name
[________________]

[ Continue ]
```

---

# 15. Resolution Information

The application should be able to display the image resolution received from the Arducam IMX219.

Example:

```text
Image Resolution
3280 × 2464 px
```

If the hardware/software supports user-selectable resolution, only display supported resolution options.

Do not invent arbitrary resolution values.

Resolution information should remain secondary to the medical image itself.

---

# 16. Navigation Structure

The navigation should remain simple.

Suggested primary structure:

```text
Dashboard
New Examination
Settings
```

The current examination should have a clear step progression.

Do not introduce complex multi-level navigation.

---

# 17. Required Screens

The generated interface should include the following screens.

## 17.1 Login

Purpose:
Authenticate healthcare workers.

Elements:

* OCEDA branding
* Email / username
* Password
* Login button
* Clear validation states

---

## 17.2 Dashboard

Purpose:
Provide a simple starting point.

Elements:

* Greeting
* User/account information
* `Start New Examination`
* Device connection status
* Simple system information

Do not turn the dashboard into an analytics dashboard.

---

## 17.3 Patient Information

Purpose:
Collect or confirm patient information.

Required fields:

* Patient ID
* Patient Name

Primary action:

`Continue`

---

## 17.4 Ready for Capture

Purpose:
Prepare the healthcare worker to use the physical OCEDA device.

Elements:

* Device status
* Short instruction
* Capture progress
* Clear indication that capture happens using the physical device

Example:

```text
Ready for Capture

Use the OCEDA device and press the physical
capture button to take an image.

Capture 0 of 3

[ Waiting for Device ]
```

---

## 17.5 Capture Receiving

Purpose:
Communicate image transmission progress.

Possible UI:

```text
Receiving Capture

Capture 1 of 3

[ Image / Loading Area ]

Receiving image from OCEDA device...
```

---

## 17.6 Capture Review

Purpose:
Allow the user to review and select the best capture.

Elements:

* Large medical image
* Capture counter
* Previous / Next navigation
* Resolution
* `Choose This Capture`

---

## 17.7 Analysis

Purpose:
Communicate that AI processing is occurring.

Elements:

* Selected image
* Processing indicator
* Clear progress message

Example:

```text
Analyzing Capture

The AI is analyzing the selected ear canal image.

Please wait...
```

---

## 17.8 Result

Purpose:
Present the AI analysis clearly.

Elements:

* Normal / Abnormal classification
* Confidence score
* Medical image
* Heatmap
* Clear interpretation structure
* Email delivery status

---

## 17.9 Settings

Settings should remain focused on relevant application preferences.

Potential settings:

* Light / Dark mode
* Image resolution information or supported resolution setting
* Account information
* Registered email information

Do not create unnecessary technical configuration panels.

---

# 18. Visual Direction

The visual direction is inspired by modern health-tech interfaces.

The moodboard combines:

* Clinical blue
* Warm coral/salmon
* Soft neutral backgrounds
* Clean white/light surfaces
* Dark diagnostic interfaces
* Modern sans-serif typography
* Rounded interface elements
* Strong visual hierarchy

The overall appearance should feel:

**Clinical + Modern + Calm + Friendly + Trustworthy**

---

# 19. Color Palette

Primary palette:

| Color           | HEX       | Intended Use                                              |
| --------------- | --------- | --------------------------------------------------------- |
| Primary Blue    | `#2E52D0` | Primary CTA, active navigation, primary interaction       |
| Secondary Blue  | `#4E72D4` | Secondary actions, information highlights                 |
| Light Blue      | `#D9E3F8` | Soft tags, selected states, subtle highlights             |
| Light Blue-Gray | `#EFF2F7` | Light mode background                                     |
| Warm Ivory      | `#EBE9E4` | Soft neutral surfaces                                     |
| Soft Gray       | `#D5D3CE` | Borders, dividers, inactive elements                      |
| Coral / Salmon  | `#FF6F64` | Warm accent, attention states, selected secondary actions |
| Light Peach     | `#FCD4CD` | Soft warm surfaces                                        |
| Slate Blue      | `#50819E` | Supporting text and medical/instrument accents            |
| Pale Sky Blue   | `#BDE1EC` | Secondary information surfaces                            |
| Warm Cream      | `#FBF6F0` | Warm card surfaces                                        |
| Neutral Cream   | `#E7E2D8` | Secondary containers                                      |

The palette should not require every color to be used on every screen.

Use the smallest number of colors necessary to create a clear hierarchy.

---

# 20. Dark Mode

Dark mode is particularly relevant to the diagnostic image experience.

The dark interface should:

* Reduce visual distraction around medical images.
* Provide strong contrast.
* Prevent unnecessary bright surfaces around the image.
* Preserve accurate image visualization.

Do not simply invert the light theme.

Dark mode should use intentionally selected dark surfaces while retaining the OCEDA blue and salmon accents.

Medical images should remain visually dominant.

---

# 21. Light Mode

Light mode should feel:

* Clean
* Calm
* Professional
* Approachable

Use:

* Light blue-gray backgrounds
* White or warm neutral surfaces
* Blue primary actions
* Restrained salmon accents

Avoid making the entire interface pure white if a softer neutral surface creates better visual hierarchy.

---

# 22. Typography

Use a modern sans-serif typeface.

Typography should prioritize:

* High readability
* Clear hierarchy
* Strong numerical readability
* Comfortable mobile reading

Suggested hierarchy:

```text
Page Title
↓
Section Heading
↓
Card / Component Title
↓
Body Text
↓
Supporting Information
↓
Caption / Metadata
```

Important clinical information such as:

* Normal
* Abnormal
* Confidence percentage
* Patient ID

should have stronger visual hierarchy than secondary metadata.

---

# 23. Shape Language

Use:

* Rounded cards
* Rounded buttons
* Soft containers
* Moderate corner radius
* Clear spacing

Rounded components should make the interface feel approachable.

Avoid excessive pill-shaped elements.

Pills should primarily be used for:

* Status
* Tags
* Compact metadata

Buttons should remain clearly recognizable as buttons.

---

# 24. Buttons

Primary buttons:

* Primary blue
* High contrast
* Clear text
* Prominent enough to identify the next action

Examples:

```text
Start New Examination
Continue
Choose This Capture
Analyze This Capture
Try Again
Finish
```

Secondary buttons should be visually less dominant.

Do not create multiple competing primary CTAs on the same screen.

---

# 25. Status Indicators

Status indicators should combine:

* Color
* Icon where appropriate
* Text

Do not communicate system state through color alone.

Example:

```text
● Device Connected
```

rather than relying only on a green dot.

---

# 26. Responsive Design

OCEDA is mobile-first but must work across:

* Mobile
* Tablet
* Desktop

## Mobile

Prioritize:

* Large medical image
* Large touch targets
* Simple navigation
* Clear primary CTA
* Minimal secondary information

## Tablet

Use additional horizontal space to improve image viewing and information grouping.

## Desktop

Use the larger screen to create comfortable layouts, but do not introduce unnecessary complexity.

Desktop may use:

* Wider image viewer
* Side-by-side result information
* More spacious content areas

Do not simply stretch the mobile interface across the entire desktop viewport.

---

# 27. Accessibility

The interface should prioritize:

* Strong text contrast
* Readable font sizes
* Large touch targets
* Clear focus states
* Text labels for important statuses
* Meaningful error messages
* Color-independent status communication

Important actions should remain understandable without relying only on color.

---

# 28. Error and Recovery States

The system must communicate errors clearly and provide a recovery action whenever possible.

Required cases include:

### Device Disconnected

```text
OCEDA device disconnected.

Reconnect the device and try again.

[ Retry Connection ]
```

### Image Transmission Failed

```text
We couldn't receive the capture.

Check the device connection and try again.

[ Retry ]
```

### AI Analysis Failed

```text
The image could not be analyzed.

Please try again or select another capture.

[ Try Again ]
```

### Email Delivery Failed

```text
The analysis result could not be sent to your registered email.

[ Try Again ]
```

Errors should explain:

1. What happened.
2. What the user can do next.

---

# 29. Loading States

Avoid generic indefinite spinners where possible.

Use contextual messages.

Examples:

```text
Connecting to device...
Receiving capture...
Preparing image...
Analyzing capture...
Sending result...
```

The user should always know what the system is currently doing.

---

# 30. Empty States

Empty states should explain what the user needs to do.

Example:

```text
No captures yet.

Use the physical OCEDA device to capture
an ear canal image.
```

Do not show empty dashboards with unexplained blank spaces.

---

# 31. Medical Image and Heatmap Rules

The medical image is a clinical visualization, not decorative content.

Therefore:

* Preserve aspect ratio.
* Avoid unnecessary filters.
* Avoid aggressive color manipulation.
* Avoid distortion.
* Avoid excessive overlays.
* Keep the heatmap interpretable.
* Ensure the original image remains visible.
* Use sufficient contrast between image and surrounding UI.

If an overlay is used, it should support interpretation rather than obscure the anatomy.

---

# 32. AI Result Communication

The AI output should be presented as an AI-assisted result.

The interface should not visually imply that the classification replaces professional medical judgment.

The result should prioritize:

```text
Classification
↓
Confidence
↓
Heatmap
↓
Supporting information
```

Avoid unnecessarily technical AI terminology.

Do not add model-training controls or AI configuration panels to the healthcare worker interface.

---

# 33. Moodboard References to Keep

The following characteristics from the moodboard should influence OCEDA:

### Keep

* Clinical blue palette
* Coral/salmon accent
* Soft neutral surfaces
* Clean light mode
* Dark diagnostic mode
* Modern sans-serif typography
* Rounded UI components
* Strong information hierarchy
* Large medical imagery
* Calm health-tech aesthetic
* Professional but approachable visual language

### Adapt

The moodboard includes several patient-facing healthcare concepts such as doctor booking, service cards, consultation scheduling, and clinic landing pages.

These should **not** become OCEDA features.

Only their visual language may be used where appropriate.

---

# 34. Features Explicitly Outside OCEDA Scope

Do not invent or add:

* Live camera preview
* Browser camera access
* Video recording
* Doctor appointment scheduling
* Doctor search
* Doctor booking
* Billing/payment
* Prescription management
* Patient chat
* Telemedicine
* Persistent medical image gallery
* Medical history timeline
* AI model training controls
* AI parameter configuration
* Raspberry Pi management dashboard
* ESP32 management dashboard
* Server monitoring dashboard
* Arbitrary email input
* Unnecessary patient demographics
* Generic analytics dashboard

---

# 35. Design Priority

When making design decisions, prioritize in this order:

1. **Clinical usability**
2. **Medical image visibility**
3. **Clear user flow**
4. **Clear system state**
5. **Primary action visibility**
6. **Accessibility**
7. **Visual consistency**
8. **Aesthetic polish**

If visual aesthetics conflict with clinical usability, clinical usability wins.

---

# 36. Stitch Generation Guidelines

When generating OCEDA UI from this document:

* Generate a complete responsive web application.
* Do not generate only a landing page.
* Follow the defined user flow.
* Treat this document as the source of truth.
* Use the attached OCEDA moodboard as visual inspiration.
* Preserve the specified color palette.
* Preserve the clinical + friendly health-tech character.
* Do not invent features outside the defined scope.
* Do not introduce a live camera preview.
* Do not introduce video recording.
* Do not introduce persistent medical image storage.
* Do not introduce appointment or billing functionality.
* Generate coherent states for normal, loading, error, and success conditions.
* Ensure all screens belong to the same design system.
* Ensure mobile, tablet, and desktop layouts are intentionally designed.
* Prioritize the examination workflow over decorative UI.

The final design should feel like one coherent healthcare product rather than a collection of unrelated generated screens.

---

# 37. Source of Truth

This document defines the intended OCEDA UI/UX behavior and visual direction.

When there is a conflict:

```text
Project requirements
        ↓
DESIGN.md
        ↓
Core interaction flow
        ↓
Stitch-generated UI
        ↓
Figma visual refinement
```

Stitch output should be treated as generated design material, not as the authority over product behavior.

Any generated feature that contradicts this document should be removed or revised.
