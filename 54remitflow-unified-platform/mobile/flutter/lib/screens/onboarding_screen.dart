import 'package:flutter/material.dart';
import '../services/analytics_service.dart';

class OnboardingScreen extends StatefulWidget {
  @override
  _OnboardingScreenState createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  int _currentPage = 0;
  final PageController _pageController = PageController();

  final List<Map<String, String>> pages = [
    {
      'title': 'Send Money Globally',
      'description': 'Transfer funds to over 50 countries using multiple payment systems',
      'emoji': '💸',
    },
    {
      'title': 'Secure & Fast',
      'description': 'Bank-level security with biometric authentication and instant transfers',
      'emoji': '🔒',
    },
    {
      'title': 'Low Fees',
      'description': 'Competitive exchange rates and transparent fees. No hidden charges',
      'emoji': '💰',
    },
    {
      'title': 'Track Everything',
      'description': 'Real-time transaction tracking and detailed history',
      'emoji': '📊',
    },
  ];

  @override
  void initState() {
    super.initState();
    AnalyticsService.trackScreenView('Onboarding');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.topRight,
              child: TextButton(
                onPressed: () {
                  AnalyticsService.trackEvent('onboarding_skipped', {'step': _currentPage});
                  Navigator.pushReplacementNamed(context, '/dashboard');
                },
                child: Text('Skip'),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: pages.length,
                onPageChanged: (index) {
                  setState(() {
                    _currentPage = index;
                  });
                },
                itemBuilder: (context, index) {
                  final page = pages[index];
                  return Padding(
                    padding: EdgeInsets.all(40),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          page['emoji']!,
                          style: TextStyle(fontSize: 120),
                        ),
                        SizedBox(height: 40),
                        Text(
                          page['title']!,
                          style: TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        SizedBox(height: 16),
                        Text(
                          page['description']!,
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey[600],
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                pages.length,
                (index) => Container(
                  margin: EdgeInsets.symmetric(horizontal: 4),
                  width: _currentPage == index ? 24 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _currentPage == index ? Colors.blue : Colors.grey[300],
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            ),
            SizedBox(height: 32),
            Padding(
              padding: EdgeInsets.all(40),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    if (_currentPage < pages.length - 1) {
                      _pageController.nextPage(
                        duration: Duration(milliseconds: 300),
                        curve: Curves.easeInOut,
                      );
                    } else {
                      AnalyticsService.trackEvent('onboarding_completed', {});
                      Navigator.pushReplacementNamed(context, '/dashboard');
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    padding: EdgeInsets.all(18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    _currentPage == pages.length - 1 ? 'Get Started' : 'Next',
                    style: TextStyle(fontSize: 18),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
