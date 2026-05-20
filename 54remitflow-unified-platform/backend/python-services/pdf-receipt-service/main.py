
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fpdf import FPDF
import os

app = FastAPI(
    title="PDF Receipt Service",
    description="Generates and serves PDF receipts for financial transactions.",
    version="1.0.0",
)

class TransactionData(BaseModel):
    transaction_id: str
    sender_name: str
    recipient_name: str
    amount_sent: float
    currency_sent: str
    amount_received: float
    currency_received: str
    exchange_rate: float
    fee: float
    date: str

RECEIPT_DIR = "/tmp/receipts"
if not os.path.exists(RECEIPT_DIR):
    os.makedirs(RECEIPT_DIR)

class PDF(FPDF):
    def header(self):
        self.set_font("Arial", "B", 12)
        self.cell(0, 10, "RemitFlow Transaction Receipt", 0, 1, "C")

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}", 0, 0, "C")

@app.post("/v1/receipts/generate")
async def generate_receipt(transaction: TransactionData):
    pdf = PDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    
    pdf.cell(200, 10, txt=f"Transaction ID: {transaction.transaction_id}", ln=1)
    pdf.cell(200, 10, txt=f"Date: {transaction.date}", ln=1)
    pdf.cell(200, 10, txt="", ln=1) # Spacer
    pdf.cell(200, 10, txt=f"Sender: {transaction.sender_name}", ln=1)
    pdf.cell(200, 10, txt=f"Recipient: {transaction.recipient_name}", ln=1)
    pdf.cell(200, 10, txt="", ln=1) # Spacer
    pdf.cell(200, 10, txt=f"You Sent: {transaction.amount_sent:.2f} {transaction.currency_sent}", ln=1)
    pdf.cell(200, 10, txt=f"They Received: {transaction.amount_received:.2f} {transaction.currency_received}", ln=1)
    pdf.cell(200, 10, txt=f"Exchange Rate: 1 {transaction.currency_sent} = {transaction.exchange_rate} {transaction.currency_received}", ln=1)
    pdf.cell(200, 10, txt=f"Fee: {transaction.fee:.2f} {transaction.currency_sent}", ln=1)
    
    file_path = os.path.join(RECEIPT_DIR, f"{transaction.transaction_id}.pdf")
    pdf.output(file_path)
    
    return {"message": "Receipt generated successfully", "receipt_id": transaction.transaction_id}

@app.get("/v1/receipts/{receipt_id}")
async def download_receipt(receipt_id: str):
    file_path = os.path.join(RECEIPT_DIR, f"{receipt_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Receipt not found")
    return FileResponse(file_path, media_type="application/pdf", filename=f"receipt_{receipt_id}.pdf")

@app.get("/")
async def root():
    return {"service": "PDF Receipt Service", "status": "ok"}
