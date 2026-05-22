import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/future_proofing_service.dart';

class ConversationalPaymentsScreen extends StatefulWidget {
  const ConversationalPaymentsScreen({super.key});

  @override
  State<ConversationalPaymentsScreen> createState() => _ConversationalPaymentsScreenState();
}

class _ConversationalPaymentsScreenState extends State<ConversationalPaymentsScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];
  bool _isProcessing = false;

  @override
  void initState() {
    super.initState();
    _messages.add(_ChatMessage(
      text: 'Hi! I can help you send money. Try saying:\n'
          '• "Send ₦50,000 to Emeka"\n'
          '• "Pay \$200 to John in Kenya"\n'
          '• "Transfer 500 euros to Maria"',
      isUser: false,
    ));
  }

  Future<void> _handleSubmit() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _isProcessing) return;

    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: true));
      _isProcessing = true;
    });
    _controller.clear();
    HapticFeedback.lightImpact();

    try {
      final result = await futureProofingService.parsePaymentIntent(text);
      final intent = result['intent'] as Map<String, dynamic>?;

      if (intent != null && intent['action'] == 'send_money') {
        final amount = intent['amount'];
        final currency = intent['currency'] ?? 'NGN';
        final recipient = intent['recipient'] ?? 'Unknown';
        final confidence = (intent['confidence'] as num?)?.toDouble() ?? 0;

        setState(() {
          _messages.add(_ChatMessage(
            text: 'I understood:\n'
                '💰 Amount: $currency ${amount?.toStringAsFixed(2)}\n'
                '👤 Recipient: $recipient\n'
                '📊 Confidence: ${(confidence * 100).toStringAsFixed(0)}%\n\n'
                'Would you like to proceed with this transfer?',
            isUser: false,
            action: _PaymentAction(
              amount: (amount as num).toDouble(),
              currency: currency.toString(),
              recipient: recipient.toString(),
            ),
          ));
        });
      } else {
        setState(() {
          _messages.add(_ChatMessage(
            text: "I couldn't parse a payment from that. Try something like:\n"
                '"Send ₦50,000 to Emeka" or "Pay \$200 to John"',
            isUser: false,
          ));
        });
      }
    } catch (e) {
      setState(() {
        _messages.add(_ChatMessage(
          text: 'Sorry, something went wrong. Please try again.',
          isUser: false,
        ));
      });
    } finally {
      setState(() => _isProcessing = false);
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Payment Assistant'),
        centerTitle: true,
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) => _buildMessage(_messages[index]),
            ),
          ),
          if (_isProcessing)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  SizedBox(width: 8),
                  Text('Analyzing your request...', style: TextStyle(color: Colors.grey)),
                ],
              ),
            ),
          _buildInputBar(),
        ],
      ),
    );
  }

  Widget _buildMessage(_ChatMessage message) {
    return Align(
      alignment: message.isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: message.isUser ? Theme.of(context).primaryColor : Colors.grey[100],
          borderRadius: BorderRadius.circular(16).copyWith(
            bottomRight: message.isUser ? const Radius.circular(4) : null,
            bottomLeft: !message.isUser ? const Radius.circular(4) : null,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message.text,
              style: TextStyle(
                color: message.isUser ? Colors.white : Colors.black87,
                fontSize: 15,
              ),
            ),
            if (message.action != null) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        HapticFeedback.mediumImpact();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Transfer initiated!')),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Confirm'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        setState(() {
                          _messages.add(_ChatMessage(text: 'Transfer cancelled.', isUser: false));
                        });
                      },
                      style: OutlinedButton.styleFrom(
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Cancel'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.of(context).padding.bottom + 8),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 4, offset: const Offset(0, -2))],
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              decoration: InputDecoration(
                hintText: 'Type a payment request...',
                filled: true,
                fillColor: Colors.grey[100],
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _handleSubmit(),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: _handleSubmit,
            icon: Icon(Icons.send, color: Theme.of(context).primaryColor),
            style: IconButton.styleFrom(
              backgroundColor: Theme.of(context).primaryColor.withValues(alpha: 0.1),
              shape: const CircleBorder(),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}

class _ChatMessage {
  final String text;
  final bool isUser;
  final _PaymentAction? action;

  _ChatMessage({required this.text, required this.isUser, this.action});
}

class _PaymentAction {
  final double amount;
  final String currency;
  final String recipient;

  _PaymentAction({required this.amount, required this.currency, required this.recipient});
}
