import 'package:flutter/material.dart';

class SendAbroadScreen extends StatelessWidget {
  const SendAbroadScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Send Abroad')),
      body: const Center(child: Text('Select a corridor to send money abroad')),
    );
  }
}
