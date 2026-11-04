Feature: Premerge regression of integrated PR151 core and affected flows
  Background:
    Given the current integrated commit is loaded in the isolated Electron test profile
    And the client and admin UI target only the masterino-test candidate services
    And test records and files use the qa-premerge-1102 prefix
    And screenshots, console errors, request IDs and relevant service logs are recorded without secrets

  @PM01 @computer_use
  Scenario: Import, edit and download the current personal Skill snapshot
    Given a synthetic ZIP contains SKILL.md and references/marker.md with distinct markers
    When I import it from the Skill store through the file chooser
    And I open its detail, edit the body and description, and save
    Then the mounted detail shows the new body and description
    When I open references/marker.md and download the Skill through its menu
    Then the reference marker remains visible
    And the downloaded ZIP independently contains the edited body, description and original reference

  @PM02 @computer_use
  Scenario: An invalid ZIP can be replaced without leaving a stale error
    When I choose a ZIP without SKILL.md in the import dialog
    Then the dialog reports an import failure without reporting success
    When I choose a valid ZIP in the same dialog
    Then the imported Skill appears with its expected content
    And the old error is absent
    When I close and reopen the import dialog
    Then it shows a fresh upload state

  @PM03 @computer_use @service_evidence
  Scenario: Personal submission is reviewed as an immutable version and published
    Given a personal Skill has the PM01 edited body and reference
    When I click submit for review and confirm the personal Skill selection
    Then Electron reports the actual submitted version
    When I open that version in the test admin review queue
    Then its preview contains the exact submitted body and reference
    When the test reviewer manually advances scan-start, scan-passed, approve and publish
    Then the refreshed Electron catalog shows the approved description
    And the published download matches the reviewed archive

  @PM04 @computer_use @service_evidence
  Scenario: A pending update preserves the published version and rollback restores one version consistently
    Given a synthetic Skill V1 is published with distinct body, reference and description markers
    When I edit its personal draft and submit V2
    Then the public catalog and default download still contain V1
    When the test reviewer publishes V2
    Then the refreshed catalog and default installation contain V2
    Given V1 was deprecated before V2 was published
    When the test admin rolls the resource back to V1
    Then the catalog description, default download and fresh installation all contain V1
    And the author's personal draft remains available

  @PM05 @computer_use
  Scenario: An installed Skill still activates and reads its bundled reference in chat
    Given the test user has an installed synthetic Skill with an exact reference marker
    When I start a new chat and ask the assistant to activate that Skill and read its reference
    Then the tool result contains the exact reference marker
    And the operation finishes without archive hash mismatch or repeated execution
    When I switch away and reopen the conversation
    Then its completed tool result and installed Skill remain available

  @PM06 @computer_use
  Scenario: Ordinary chat with a document attachment still works
    Given a synthetic text attachment contains only the unique marker PREMERGE_ATTACHMENT_OK
    When I start a new chat and send a simple question without tools
    Then the assistant returns a normal answer and the message completes
    When I attach the synthetic file through the UI and ask for its marker
    Then the upload completes and the assistant returns the marker from that attachment
    And no unintended Skill submission or project authoring operation occurs

  @PM07 @computer_use @service_evidence
  Scenario: Markdown-only URL reimport retains attachments and refreshes the mounted detail
    Given a Skill was imported from an approved synthetic HTTPS URL as a ZIP with references/retained.md
    And its detail is open in Electron
    When the same test URL serves only a revised SKILL.md
    And I reimport that URL through the UI
    Then the detail displays the revised body without reloading the Electron window
    And references/retained.md still displays its original marker

  @PM08 @computer_use @service_evidence
  Scenario: Conversation submission of a personal Skill does not require a project directory
    Given a personal synthetic Skill exists and the new chat has no selected project directory
    When I explicitly ask to submit that exact Skill for community review
    And I approve the submitSkill tool when manual approval is requested
    Then the tool reports its actual resource and version IDs and review state
    And the test Market contains the matching archive
    And no project directory or project Skill is created as a side effect

  @PM09 @computer_use @filesystem_evidence
  Scenario: Existing project Skill authoring still uses the selected workspace
    Given a chat is bound to a synthetic writable project directory
    When I ask the assistant to create a project Skill and then update its instructions
    And I approve the requested mutating tools in manual mode
    Then createProjectSkill, updateProjectSkill and validateProjectSkill finish successfully
    And the actual Skill files contain the revised marker under that project
    And no personal library import or community submission occurs without a separate request

  @PM10 @computer_use @filesystem_evidence
  Scenario: A new external Word is created after one-time parent-directory consent
    Given the chat is bound to synthetic directory A and external directory B exists
    And B has no file named qa-premerge-1102-allow.docx
    When I ask createOfficeDocument to create that file with an exact body marker
    Then the consent card shows directory B, the target file and write access
    When I click approve only this time
    Then the original operation resumes and completes
    And independent inspection of the actual Word file confirms the body marker
    And the chat remains bound to directory A
    When I request another new file in B in a new operation
    Then a fresh path consent is requested

  @PM11 @computer_use @filesystem_evidence
  Scenario: Denied and invalid new-file requests leave no output and the chat can recover
    Given the chat uses synthetic directory A and external directory C exists
    When I request a new file in C and reject its consent card
    Then no target file is created
    When I request a Word below a missing direct child directory of C
    Then the operation cannot claim a successful creation or create that parent directory
    When I request a normal new file inside A
    Then it is created with the expected marker and the operation finishes

  @PM12 @computer_use @worker_evidence
  Scenario: Enabled personal memory extracts and retrieves a durable preference
    Given personal memory is enabled for the synthetic test user
    When I state a unique durable preference in a completed chat through Electron
    And the current candidate memory worker processes that exact conversation through the normal extraction entry point
    Then worker logs identify that conversation and a successful extraction
    And the stored memory belongs to that user and contains the preference
    When I open the memory UI and retrieve or ask about that preference in a new chat
    Then the expected preference is available
    And a model or validation failure is recorded as a failure rather than an empty success

  @PM13 @computer_use @worker_evidence
  Scenario: Turning personal memory off prevents new extraction
    Given the synthetic user's personal memory is enabled
    When I turn it off in Electron and complete a new chat containing another unique preference
    And I observe the normal extraction eligibility check for that exact conversation
    Then the new conversation causes no memory extraction model request or new preference record
    And ordinary chat still completes

  @PM14 @deterministic_regression
  Scenario: Invalid memory output receives only the existing single correction attempt
    Given an extractor returns a schema-invalid object or malformed persona tool JSON
    When the current extractor validates that output
    Then it can request one corrected result with the original shared deadline
    And a second invalid result remains a failure
    And network or HTTP failure does not gain an extra correction retry

  @PM15 @computer_use
  Scenario: Unsupported NUL text encoding is rejected and retry recovers
    Given a valid ZIP includes an UTF-16LE scripts/install.sh with an installer command
    When I upload and submit it through the community form
    Then the service reports that text resources require UTF-8 without NUL
    When I choose a valid ZIP in the same form and submit again
    Then submission succeeds and reopening the form has no old error

  @PM16 @computer_use
  Scenario: Switching Skills resets a reference selection
    Given I selected references/retained.md in the URL Skill
    When I select another Skill that only has references/marker.md
    Then its SKILL.md body is visible instead of an empty content panel
