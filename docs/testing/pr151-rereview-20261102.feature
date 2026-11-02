Feature: PR151 review corrections against the test cluster
  Background:
    Given the Electron client and admin UI use isolated masterino-test candidates
    And all new resources use the qa-rereview prefix

  @computer-use
  Scenario: Rollback restores the catalog and the installed archive together
    Given V1 is deprecated and V2 is published with different metadata and content
    When the administrator clicks rollback and enters the V1 version
    Then the admin row and refreshed Electron store show the V1 name and description
    When I click install in Electron
    Then the installed body and reference contain the V1 markers
    And downloading without a version returns the same V1 archive

  @computer-use
  Scenario: Review comparison cannot use a newer rejected version
    Given V2 is published, V3 is submitted and newer V4 is rejected
    When I open the review queue and expand the V3 configuration difference
    Then the previous configuration is V2 and the current configuration is V3
    And V4 is absent from the actionable Skill queue

  @computer-use
  Scenario: A Markdown-only URL update preserves attachments and refreshes the open detail
    Given I imported a ZIP with references/retained.md from an approved HTTPS test URL
    And its detail is already open
    When the same URL serves only a revised SKILL.md
    And I import that URL again through Electron
    Then the same detail displays the revised body without reloading the window
    When I click references/retained.md
    Then its original content is visible
    And an exported ZIP contains both the revised body and original reference bytes

  @computer-use
  Scenario: A bad ZIP does not leave an error after a successful retry
    When I upload a ZIP without SKILL.md in the import dialog
    Then an import error is visible
    When I choose a valid ZIP in that same dialog
    Then the success message is visible and the old error is absent

  @computer-use
  Scenario: Ordinary shell documentation can be submitted
    Given my personal Skill contains the line "zsh is the default shell"
    When I click submit for review from the successful import dialog
    Then Electron confirms submission and the test market contains a submitted version

  @http-integration
  Scenario: ZIP metadata is authoritative and still subject to validation
    Given form metadata disagrees with the ZIP frontmatter
    When I submit to either market submission boundary
    Then the stored name, description and file manifest come from the ZIP
    But a prohibited command in that ZIP frontmatter is rejected before storage

  @database-integration
  Scenario: Empty complete ZIP and absent resource bundle have different meanings
    Given a Skill already has a reference
    When I update it with a Markdown-only source
    Then the reference remains
    When I replace it with a complete ZIP containing no attachments
    Then the old reference is removed

  @database-integration
  Scenario: Publication bookkeeping does not overwrite an edit made during submission
    Given submission has read a Skill and is awaiting the market response
    When another save changes its editor metadata
    And submission completes
    Then publication metadata is recorded and the newer editor metadata remains

  @unit
  Scenario: Malformed persona tool JSON gets only the existing correction opportunity
    Given the first persona tool arguments are malformed JSON
    When extraction validates the result
    Then it requests one correction using the same deadline signal
    And a second invalid result or a transport failure still fails

  @filesystem-integration
  Scenario: New-file consent never offers an entire sensitive system root
    When a missing file is directly below a system root or its macOS canonical alias
    Then the helper offers no directory grant
    But a new file under an existing temporary output directory still supports operation consent
