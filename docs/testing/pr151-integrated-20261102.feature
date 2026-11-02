Feature: Integrated Masterino core flows (PR148 + PR151 + PR152)
  Background:
    Given the integrated Electron client uses the isolated test profile
    And only the masterino-test cluster and synthetic qa-pr151-1102 data are used

  Scenario: Edit, export and submit a personal skill
    Given a ZIP skill contains a SKILL.md and a reference marker
    When I import it through the skill store and edit its body
    And I save, reopen, download and submit it for review
    Then the detail and exported ZIP contain the current body and reference
    And the review candidate contains the same content

  Scenario: Invalid submission is recoverable
    When I choose a ZIP without SKILL.md
    Then the UI reports an actionable error
    When I choose a valid ZIP in the same flow
    Then submission can complete

  Scenario: Published metadata follows the approved version
    Given V1 is published with the original description
    When V2 with a new description is submitted
    Then the catalog still shows the V1 description
    When V2 is scanned, approved and published
    Then the catalog shows the V2 description

  Scenario: New external Word is approved and actually created
    Given the direct parent of a new output file exists outside the working directory
    When I request createOfficeDocument and approve only this time
    Then the card identifies the file and the parent directory
    And the resumed tool creates a Word document with the requested marker
    And a subsequent operation needs a new approval

  Scenario: Rejected creation and missing parent do not create output
    When I reject an external file creation
    Then no file is created
    When I request a file below a missing direct parent
    Then the app reports failure without creating ancestor directories

  Scenario: Memory extraction preserves validation
    Given personal memory is enabled for a synthetic test user
    When a conversation states an explicit durable preference
    And the extraction worker processes that conversation
    Then valid memory is persisted and retrievable
    And schema-invalid output gets at most one correction within the original deadline
    And a second invalid output remains a failure
