Feature: Aihub subscription UI
  The avatar card shows account funding and opens the provider details.
  Subscription dates and quota are independent from wallet balance.

  Scenario: Monthly quota within an annual subscription
    Given the subscription preview has "active" data
    When I open the avatar account card
    Then the card shows "订阅剩余额度" and "¥592.41"
    And the card shows "钱包余额" and "¥699.89"
    And the card shows "累计已用金额" and "¥107.59"
    And the account card does not show requests
    When I open the account details
    Then the provider shows "订阅有效期至" and "2027"
    And the provider shows "下次额度重置" and "2026/11/01"
    And the subscription action is "管理订阅"
    And opening the avatar does not refresh models

  Scenario: No subscription with a funded wallet
    Given the subscription preview has "none" data
    When I open the avatar account card
    Then the card shows "订阅剩余额度" and "暂无有效订阅"
    When I open the account details
    Then the subscription action is "开通订阅"
    And the provider shows "钱包余额" and "¥699.89"

  Scenario: Failed read is not an unsubscribed account
    Given the subscription preview has "error" data
    Then the provider shows "订阅信息暂时无法获取" and "管理订阅"
    And the provider does not offer a false subscription state

  Scenario: Exhausted subscription preserves the next reset
    Given the subscription preview has "exhausted" data
    Then the provider shows "本期额度已用尽" and "重置为 ¥700.00"
    And the subscription action is "管理订阅"

  Scenario: Expired subscription has an activation action
    Given the subscription preview has "expired" data
    Then the provider shows "暂无有效订阅" and "已到期"
    And the subscription action is "开通订阅"

  Scenario: Multiple subscriptions keep their own reset amounts
    Given the subscription preview has "multiple" data
    Then two subscription plans are visible
    And the provider shows "重置为 ¥700.00" and "重置为 ¥140.00"

  Scenario: Narrow width keeps the subscription action usable
    Given the subscription preview has "narrow" data
    Then the subscription action is "管理订阅"
    And the subscription content does not overflow the viewport

  Scenario: A stale reset timestamp does not fabricate replenished quota
    Given the subscription preview has "pending" data
    Then the provider shows "额度重置待更新" and "¥592.41"

  Scenario: The actual wallet-first preference is displayed
    Given the subscription preview has "wallet" data
    Then the provider shows "扣费方式" and "钱包优先"
