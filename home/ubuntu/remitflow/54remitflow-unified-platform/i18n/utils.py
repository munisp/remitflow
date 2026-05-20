import json

class I18n:
    def __init__(self, lang=\'en\'):
        self.lang = lang
        self.translations = self.load_translations()

    def load_translations(self):
        try:
            with open(f\'/home/ubuntu/remitflow/54remitflow-unified-platform/i18n/{self.lang}.json\") as f:
                return json.load(f)
        except FileNotFoundError:
            with open(f\'/home/ubuntu/remitflow/54remitflow-unified-platform/i18n/en.json\") as f:
                return json.load(f)

    def t(self, key):
        return self.translations.get(key, key)
