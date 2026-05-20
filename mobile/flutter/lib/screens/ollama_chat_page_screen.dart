import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class OllamaChatPageScreen extends ConsumerStatefulWidget {
  const OllamaChatPageScreen({super.key});
  @override
  ConsumerState<OllamaChatPageScreen> createState() => _OllamaChatPageScreenState();
}

class _OllamaChatPageScreenState extends ConsumerState<OllamaChatPageScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _messages = [];
  String? _error;
  final TextEditingController _messageController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadMessages();
  }

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiServiceProvider);
      // Assuming a tRPC route for fetching chat history
      final result = await api.get('/trpc/ollamaChat.list');
      setState(() {
        _messages = List<Map<String, dynamic>>.from(result['result']['data'] ?? []);
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    setState(() {
      _messages.add({'sender': 'user', 'text': text});
      _messageController.clear();
    });

    try {
      final api = ref.read(apiServiceProvider);
      // Assuming a tRPC route for sending messages and getting a response
      final response = await api.post('/trpc/ollamaChat.send', body: {'message': text});
      setState(() {
        _messages.add({'sender': 'ollama', 'text': response['result']['data']['reply'] ?? 'No response'});
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _messages.add({'sender': 'system', 'text': 'Error: ${e.toString()}'});
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F0F23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Ollama Chat', style: TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Color(0xFFE2E8F0)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadMessages),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF6C63FF)))
                : _error != null
                    ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                    : _messages.isEmpty
                        ? const Center(child: Text('Start chatting!', style: TextStyle(color: Color(0xFF94A3B8))))
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: _messages.length,
                            itemBuilder: (context, index) {
                              final message = _messages[index];
                              final isUser = message['sender'] == 'user';
                              return Align(
                                alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: isUser ? const Color(0xFF6C63FF) : const Color(0xFF1A1A2E),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    message['text'] ?? '',
                                    style: const TextStyle(color: Color(0xFFE2E8F0)),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    style: const TextStyle(color: Color(0xFFE2E8F0)),
                    decoration: InputDecoration(
                      hintText: 'Type a message...', 
                      hintStyle: const TextStyle(color: Color(0xFF94A3B8)),
                      filled: true,
                      fillColor: const Color(0xFF1A1A2E),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(25.0),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 8),
                FloatingActionButton(
                  mini: true,
                  backgroundColor: const Color(0xFF6C63FF),
                  onPressed: _sendMessage,
                  child: const Icon(Icons.send, color: Colors.white),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
