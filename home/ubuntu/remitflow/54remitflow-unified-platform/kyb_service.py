from docling import Docling
from paddleocr import PaddleOCR
from transformers import pipeline

class KYBService:
    def __init__(self):
        self.docling = Docling()
        self.ocr = PaddleOCR(use_angle_cls=True, lang=\'en\')
        self.vlm = pipeline("visual-question-answering", model="Salesforce/blip-vqa-base")

    def analyze_document(self, document_path):
        # Use Docling to get structured data from the document
        structured_data = self.docling.parse(document_path)

        # Use PaddleOCR to extract text from the document
        ocr_result = self.ocr.ocr(document_path, cls=True)
        extracted_text = \'\


'.join([line[1][0] for line in ocr_result[0]])

        # Use the VLM to answer questions about the document
        question = "What is the company name?"
        vlm_result = self.vlm(document_path, question)

        return {
            "structured_data": structured_data,
            "extracted_text": extracted_text,
            "vlm_result": vlm_result
        }
