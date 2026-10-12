Feature: Administrator-managed access Keys
  Administrators share managed Keys while existing account permissions and personal Keys remain unchanged.

  Scenario: Create and share an owner-bound CLI credential
    Given two administrators and a regular employee in the test environment
    When the first administrator creates a named Key with purpose and expiry
    Then the other administrator can find its metadata without receiving its secret
    And the other administrator can reveal a working owner-bound credential
    And the owner cannot change or remove the shared Key through personal settings

  Scenario: Stop, resume and delete a disposable Key
    When the other administrator stops the disposable Key
    Then the credential cannot authenticate
    When the other administrator resumes the disposable Key
    Then the credential can authenticate again
    When the other administrator deletes the disposable Key
    Then its credential and metadata are no longer available

  Scenario: Preserve existing personal Keys and deny non-administrators
    Given a personal Key created through the existing API
    Then the personal Key is absent from the managed directory and cannot be managed there
    And an employee cannot list create reveal stop or delete managed Keys
    And the original administrator CLI credential still works

  Scenario: Reject an already expired Key
    When an administrator requests a Key with a past expiry
    Then validation rejects the request without creating a Key
