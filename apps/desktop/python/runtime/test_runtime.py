"""Acceptance test for a relocated, general-purpose bundled interpreter."""
import importlib.metadata
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile

from PIL import Image
from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches


class RuntimeTests(unittest.TestCase):
    def test_runtime_and_preinstalled_packages(self):
        runtime = pathlib.Path(sys.executable).resolve().parent
        if runtime.name == "bin":
            runtime = runtime.parent
        manifest = json.loads((runtime / "manifest.json").read_text())
        self.assertEqual(sys.version.split()[0], manifest["version"])
        for name, version in manifest["packages"].items():
            self.assertEqual(importlib.metadata.version(name), version)

    def test_create_inspect_and_edit_rich_presentation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            image = root / "image.png"
            Image.new("RGB", (120, 80), "#2563eb").save(image)
            deck = Presentation()
            slide = deck.slides.add_slide(deck.slide_layouts[6])
            group = slide.shapes.add_group_shape()
            text = group.shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1))
            text.text = "中文组合标题"
            table = slide.shapes.add_table(3, 2, Inches(1), Inches(2), Inches(3), Inches(2)).table
            table.cell(0, 0).text = "收入"
            table.cell(1, 0).text = "华东"
            table.cell(1, 1).text = "120"
            data = CategoryChartData()
            data.categories = ["一月", "二月"]
            data.add_series("销售", [100, 120])
            chart = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(4), Inches(1), Inches(4), Inches(3), data).chart
            chart.has_title = True
            chart.chart_title.text_frame.text = "销售趋势"
            slide.shapes.add_picture(str(image), Inches(1), Inches(5))
            slide.notes_slide.notes_text_frame.text = "中文演讲备注"
            original = root / "中文课件.pptx"
            edited = root / "修改课件.pptx"
            deck.save(original)
            loaded = Presentation(original)
            self.assertEqual(loaded.slides[0].shapes[0].shapes[0].text, "中文组合标题")
            loaded.slides[0].shapes[0].shapes[0].text = "修改后的标题"
            loaded.save(edited)
            result = Presentation(edited)
            self.assertEqual(result.slides[0].shapes[0].shapes[0].text, "修改后的标题")
            self.assertEqual(result.slides[0].shapes[1].table.cell(1, 1).text, "120")
            self.assertEqual(result.slides[0].shapes[2].chart.chart_title.text_frame.text, "销售趋势")
            self.assertIn("中文演讲备注", result.slides[0].notes_slide.notes_text_frame.text)
            with zipfile.ZipFile(original) as before, zipfile.ZipFile(edited) as after:
                self.assertEqual(set(before.namelist()), set(after.namelist()))
                for name in before.namelist():
                    if name != "ppt/slides/slide1.xml":
                        self.assertEqual(before.read(name), after.read(name), name)
                etree.fromstring(after.read("ppt/slides/slide1.xml"))


if __name__ == "__main__":
    unittest.main()
