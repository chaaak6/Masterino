@managed-home
Feature: Masterino-managed local paths
  New temporary work belongs to Masterino's user home while existing sessions
  and user-selected projects keep their original filesystem identity.

  Scenario: A new temporary topic is created under MASTERINO_HOME
    Given an isolated Masterino home and legacy Desktop storage
    When the device creates scratch workspace for topic "bdd-new-topic"
    Then the scratch workspace is under "workspaces/scratch/bdd-new-topic"
    And no new scratch workspace is created in legacy Desktop storage
    And the managed skills directory is "skills"

  Scenario: A persisted legacy topic can still be cleaned safely
    Given an isolated Masterino home and legacy Desktop storage
    And a persisted legacy scratch workspace for topic "bdd-legacy-topic"
    When the device cleans the persisted legacy scratch workspace
    Then only the persisted legacy scratch workspace is removed

  Scenario: A user-selected project remains the canonical workspace
    Given an isolated Masterino home and legacy Desktop storage
    And a user-selected project outside MASTERINO_HOME
    When the device initializes the selected project
    Then the selected project remains the initialized workspace
    And scratch storage is not created by project initialization
