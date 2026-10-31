"""显式中文路由不需要语言识别模型，也不能丢掉数字、标点和嵌入英文。"""
import unittest
from bridge import chinese_segments


class ChineseRoute(unittest.TestCase):
    def test_follows_declared_chinese(self):
        self.assertEqual(chinese_segments("先生，今天学第 3 课。"),
                         [{"lang": "zh", "text": "先生，今天学第 3 课。"}])

    def test_preserves_embedded_english_and_order(self):
        source = "使用 Anki 学习 20 个单词，再说 Hello world！"
        pieces = chinese_segments(source)
        self.assertEqual("".join(piece["text"] for piece in pieces), source)
        self.assertEqual([piece["text"] for piece in pieces if piece["lang"] == "en"], ["Anki", "Hello world"])

    def test_does_not_guess_japanese(self):
        self.assertEqual(chinese_segments("先生", "ja"), [{"lang": "ja", "text": "先生"}])
        with self.assertRaises(ValueError):
            chinese_segments("先生", "auto")


if __name__ == "__main__":
    unittest.main()
