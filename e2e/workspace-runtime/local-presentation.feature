@live-test @desktop @local-presentation
Feature: Rich PowerPoint authoring on the user's desktop
  This feature is executed through the source Electron app with Computer Use.
  It intentionally stays outside the mocked Cucumber suite and uses the test-server profile.

  Background:
    Given the source Electron app is connected to https://mlai-test.bielcrystal.com
    And the selected project is a fresh directory created by generate-fixture.py
    And the execution target visibly says 本机

  Scenario: Select the rich PowerPoint tools for a natural local request
    When I send this exact prompt through the visible composer:
      """
      请在当前项目中制作 masterino-ppt-bdd.pptx，共 3 页。第 1 页标题必须包含 LOCAL-PPT-BDD-20260929，并加入 bdd-logo.png 图片和演讲者备注；第 2 页放一个原生表格，表头是 Quarter、Revenue，数据为 Q1/100、Q2/120，并放一个 Revenue 柱状图；第 3 页标题必须包含 Next steps，并有一个蓝色圆角矩形。使用稳定的英文 slide/element id。制作后检查内容、校验文件并生成本地预览，只有校验通过才交付。整个过程必须在本机完成，不要使用 shell、Python 或云端沙箱。
      """
    Then the visible tool history contains createPresentation
    And the visible tool history contains validatePresentation
    And the visible tool history contains renderPresentationPreview
    And the assistant reports a validated three-slide PPTX
    And the generated PPTX and Masterino sidecar exist in the project directory

  Scenario: Inspect and revise the generated PPTX in place
    When I ask the agent to inspect the generated project and update the same masterino-ppt-bdd.pptx
    And I require the first title to become LOCAL-PPT-BDD-REVISED-20260929
    And I require the first image source to become replacement-logo.png
    And I require validation and previews after the revision
    Then the visible tool history contains inspectPresentation
    And the visible tool history contains revisePresentation
    And inspectPresentation reports revision 2
    And validatePresentation reports the PPTX as valid
    And the PPTX path is unchanged

  Scenario: Recover a stale revision lock through the desktop tool
    Given inject-stale-lock.py wrote a lock owned by an exited process
    When I ask the agent to revise the same first title to LOCAL-PPT-BDD-LOCK-RECOVERED-20260929
    Then revisePresentation succeeds at revision 3
    And validatePresentation and renderPresentationPreview succeed
    And verify-output.py accepts the final PPTX and replacement image

  Scenario: Reject a revision that targets an unrelated existing path
    Given protected.pptx already exists and its SHA-256 is recorded
    When I send this exact prompt through the visible composer:
      """
      请检查 masterino-ppt-bdd.pptx 对应的 Masterino 项目，然后尝试把一次空修订输出到当前项目现有的 protected.pptx；不得改名、覆盖、删除现有文件，也不要使用 shell 或其他工具。请如实返回工具错误。
      """
    Then revisePresentation reports that the destination is an unrelated existing file
    And verify-smoke.py confirms protected.pptx has the recorded SHA-256

  Scenario: Preserve established local capabilities
    When I ask the agent to use createOfficeDocument to create smoke.xlsx with one sheet and one data row
    Then the visible tool history contains createOfficeDocument
    And verify-smoke.py independently reads the expected XLSX cell values
    When I ask the agent to activate the project skill bdd-smoke and follow it exactly
    Then the assistant returns the exact marker BDD-SKILL-SMOKE-OK
    And a plain chat request still receives a normal response
