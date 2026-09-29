@live-test @desktop @packaged-ppt-worker
Feature: Edit an imported PowerPoint in the packaged desktop app
  This acceptance script runs against the test cluster with the macOS or Windows installer.

  Background:
    Given the installed Masterino test app is connected to https://mlai-test.bielcrystal.com
    And the language is 简体中文 and execution target is 本机
    And the local project contains an imported PPTX with two differently formatted text runs

  Scenario: Inspect and edit without changing the source
    When I ask the agent to inspect the imported PPTX and replace only its first text run
    And I require a new output path and inspection of the resulting PPTX
    Then the visible tool history contains inspectExistingPresentation
    And the visible tool history contains editExistingPresentation
    And the first run changes while the second run and both styles remain unchanged
    And the imported PPTX SHA-256 remains unchanged

  Scenario: Reject stale input and an existing destination
    When I ask the agent to edit with a stale expectedSha256
    Then editExistingPresentation reports PRESENTATION_SOURCE_CHANGED
    When I ask the agent to edit into an existing PPTX path
    Then the tool refuses to overwrite it
    And both existing files retain their original SHA-256 values

  Scenario: Existing local tools still work
    When I ask the agent to create and validate a rich new PPTX
    Then the visible tool history contains createPresentation and validatePresentation
    When I ask for a one-row XLSX and activate a project skill
    Then createOfficeDocument and the project skill both succeed
