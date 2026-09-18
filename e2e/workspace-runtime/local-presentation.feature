@live-test @desktop @local-presentation
Feature: Rich PowerPoint authoring on the user's desktop
  This feature is executed through the source Electron app with Computer Use.
  It intentionally stays outside the mocked Cucumber suite and uses the test-server profile.

  Background:
    Given the source Electron app is connected to https://mlai-test.bielcrystal.com
    And the selected project is a fresh directory created by generate-fixture.py
    And the execution target visibly says 本机

  Scenario: Create and validate a rich presentation locally
    When I send this exact prompt through the visible composer:
      """
      请在当前项目中使用本机 PowerPoint 工具创建 masterino-ppt-bdd.pptx，共 3 页。第 1 页标题必须包含 LOCAL-PPT-BDD-20260918，并加入 bdd-logo.png 图片和演讲者备注；第 2 页放一个原生表格，表头是 Quarter、Revenue，数据为 Q1/100、Q2/120，并放一个 Revenue 柱状图；第 3 页标题必须包含 Next steps，并有一个蓝色圆角矩形。使用稳定的英文 slide/element id。创建后必须调用 validatePresentation 和 renderPresentationPreview，只有校验通过才交付。不要使用 shell、Python、云端沙箱或 createOfficeDocument。
      """
    Then the visible tool history contains createPresentation
    And the visible tool history contains validatePresentation
    And the visible tool history contains renderPresentationPreview
    And the assistant reports a validated three-slide PPTX
    And verify-output.py accepts the PPTX with one chart, one image, one table, and speaker notes

  Scenario: Reject an attempt to overwrite an existing presentation path
    Given protected.pptx already exists and its SHA-256 is recorded
    When I send this exact prompt through the visible composer:
      """
      请只调用 createPresentation，尝试在当前项目现有的 protected.pptx 路径创建一页 PPT；不得改名、覆盖、删除现有文件，也不要使用 shell 或其他工具。请如实返回工具错误。
      """
    Then the createPresentation tool reports that the destination already exists
    And protected.pptx has the same SHA-256

  Scenario: Preserve established local capabilities
    When I ask the agent to use createOfficeDocument to create smoke.xlsx with one sheet and one data row
    Then the visible tool history contains createOfficeDocument
    And an independent XLSX ZIP check reads the expected cell values
    When I ask the agent to activate the project skill bdd-smoke and follow it exactly
    Then the assistant returns the exact marker BDD-SKILL-SMOKE-OK
    And a plain chat request still receives a normal response
