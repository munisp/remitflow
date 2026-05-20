import mlflow
import mlflow.pytorch
from gnn_model import GNN
from torch_geometric.data import Data
import torch

# Start an MLflow run
with mlflow.start_run() as run:
    # Log parameters
    mlflow.log_param("num_layers", 2)
    mlflow.log_param("hidden_channels", 16)

    # Create a model instance
    model = GNN(num_node_features=1, num_classes=2)

    # Create some dummy data
    edge_index = torch.tensor([[0, 1, 1, 2], [1, 0, 2, 1]], dtype=torch.long)
    x = torch.tensor([[-1], [0], [1]], dtype=torch.float)
    data = Data(x=x, edge_index=edge_index)

    # Train the model (in a real-world scenario, you would have a proper training loop)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4)
    model.train()
    optimizer.zero_grad()
    out = model(data)
    # Dummy loss and backward pass
    loss = torch.nn.functional.nll_loss(out, torch.tensor([1, 0, 1]))
    loss.backward()
    optimizer.step()

    # Log the model
    mlflow.pytorch.log_model(model, "model")

    # Log metrics
    mlflow.log_metric("loss", loss.item())

    print(f"Run ID: {run.info.run_id}")
