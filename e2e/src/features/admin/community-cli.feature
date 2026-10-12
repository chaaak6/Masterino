Feature: Local agents submit community resources through the CLI
  Scenario: Preview a batch without submitting
    Given local MCP JSON and a Skill directory
    When the built CLI previews the batch
    Then both resources are prepared without creating server resources

  Scenario: Submit a batch for administrator review
    Given local MCP JSON and a Skill directory
    When the built CLI submits the batch with an administrator API Key
    Then both resources are submitted and invisible to community users until publication

  Scenario: A failed batch item does not stop later submissions
    Given a batch with an existing MCP, an invalid Skill ZIP and a new valid Skill
    When the built CLI submits the mixed batch
    Then it reports two failures and one submission with a nonzero exit code

  Scenario: Invalid access credentials cannot submit resources
    Given local MCP JSON and a Skill directory
    When the built CLI submits with an invalid API Key
    Then submission fails without printing the credential
