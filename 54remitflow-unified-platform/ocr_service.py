from paddleocr import PaddleOCR

class OCRService:
    def __init__(self):
        self.ocr = PaddleOCR(use_angle_cls=True, lang=\'en\')

    def recognize_text(self, image_path):
        result = self.ocr.ocr(image_path, cls=True)
        return result
