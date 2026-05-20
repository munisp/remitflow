import torch
import numpy as np

class EnsembleModel:
    def __init__(self, tazama_model, gnn_model):
        self.tazama_model = tazama_model
        self.gnn_model = gnn_model

    def predict(self, data):
        tazama_predictions = self.tazama_model.predict(data)
        gnn_predictions = self.gnn_model(data)

        # Combine the predictions
        # For simplicity, we'll just average the predictions
        # In a real-world scenario, you would likely want to use a more sophisticated method
        # such as a weighted average or a meta-learner
        ensemble_predictions = (tazama_predictions + torch.exp(gnn_predictions)) / 2

        return ensemble_predictions
