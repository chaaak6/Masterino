Feature: Reliable community submission and remote MCP calls
  Scenario: Reject oversized source content before submission
    Given a disposable Skill directory containing an oversized file
    When the built CLI prepares the directory
    Then the CLI rejects it with the unpacked file limit

  Scenario: Validate metadata at the final Market boundary
    When an administrator directly submits a ZIP without required Skill metadata
    Then Market rejects it without creating a resource or uploading an artifact

  Scenario: Roll back failed submission and allow the same identifier to retry
    Given version insertion fails only for this disposable submission
    When an administrator submits its valid Skill ZIP
    Then the failed resource is absent
    When the injected failure is removed and the same submission is retried
    Then exactly one submitted resource exists

  Scenario: Keep employee remote MCP calls working
    When an administrator submits and publishes a remote MCP
    Then an employee can call its discovered tool without entering a credential
