Feature: Administrators extend the internal community
  Scenario: Publish a remote MCP with a company credential
    Given an administrator imports a Streamable HTTP mcpServers configuration
    When connection verification discovers tools and the administrator submits the resource
    And the resource is approved and published
    Then another employee can install it from the community without entering an API key
    And the employee can call a discovered tool
    And the shared credential is absent from community responses

  Scenario: Publish a Skill archive
    Given an administrator uploads a ZIP containing SKILL.md
    When the administrator submits and publishes the Skill
    Then another employee can discover and download the Skill archive
    And the employee can install the Skill and read its content

  Scenario: Invalid input remains unpublished
    Given a malformed MCP configuration or a ZIP without SKILL.md
    When an administrator submits it
    Then a readable validation error is displayed
    And no community resource is published

  Scenario: An un-installable Skill remains unpublished
    Given a Skill ZIP with invalid frontmatter
    When an administrator submits it
    Then a readable Skill manifest error is displayed
    And no community resource is published
