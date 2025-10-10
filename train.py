import numpy as np
import pickle
import csv
from model_class import LinearRegressionNumpy


class LinearRegressionNumpy:
    """Simple Linear Regression using only NumPy"""
    
    def __init__(self):
        self.weights = None
        self.bias = None
    
    def fit(self, X, y, learning_rate=0.01, epochs=1000):
        """Train the model using gradient descent"""
        n_samples, n_features = X.shape
        
        # Initialize parameters
        self.weights = np.zeros(n_features)
        self.bias = 0
        
        # Gradient descent
        for _ in range(epochs):
            # Forward pass
            y_predicted = np.dot(X, self.weights) + self.bias
            
            # Compute gradients
            dw = (1 / n_samples) * np.dot(X.T, (y_predicted - y))
            db = (1 / n_samples) * np.sum(y_predicted - y)
            
            # Update parameters
            self.weights -= learning_rate * dw
            self.bias -= learning_rate * db
    
    def predict(self, X):
        """Make predictions"""
        return np.dot(X, self.weights) + self.bias
    
    def score(self, X, y):
        """Calculate R² score"""
        y_pred = self.predict(X)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        ss_res = np.sum((y - y_pred) ** 2)
        return 1 - (ss_res / ss_tot)

def generate_sample_data():
    """Generate sample training data"""
    print("Generating sample training data...")
    
    # Sample data: distance_km, traffic_level, eta_minutes
    data = [
        # Short distances, low traffic
        [0.5, 1, 1.0],
        [0.8, 1, 1.6],
        [1.0, 1, 2.0],
        [1.5, 1, 3.0],
        
        # Medium distances, low traffic
        [2.0, 1, 4.0],
        [3.0, 1, 6.0],
        [4.0, 1, 8.0],
        [5.0, 1, 10.0],
        
        # Short distances, medium traffic
        [0.5, 1.5, 1.5],
        [1.0, 1.5, 3.0],
        [2.0, 1.5, 6.0],
        [3.0, 1.5, 9.0],
        
        # Medium distances, medium traffic
        [4.0, 1.5, 12.0],
        [5.0, 1.5, 15.0],
        [6.0, 1.5, 18.0],
        
        # Various distances, high traffic
        [1.0, 2, 4.0],
        [2.0, 2, 8.0],
        [3.0, 2, 12.0],
        [4.0, 2, 16.0],
        [5.0, 2, 20.0],
        
        # Long distances
        [7.0, 1, 14.0],
        [8.0, 1.5, 24.0],
        [10.0, 1, 20.0],
        [10.0, 2, 40.0],
        
        # Add some realistic variance
        [1.2, 1, 2.5],
        [2.5, 1.5, 7.5],
        [3.5, 2, 14.0],
        [4.5, 1, 9.0],
        [6.0, 2, 24.0],
    ]
    
    # Write to CSV
    with open('bus_data.csv', 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['route_id', 'stop_id', 'distance_km', 'traffic_level', 
                        'scheduled_time', 'actual_time'])
        
        for i, (dist, traffic, eta) in enumerate(data):
            route = '24A' if i % 2 == 0 else '2A'
            stop = (i % 5) + 1
            scheduled = int(eta)
            actual = eta
            writer.writerow([route, stop, dist, traffic, scheduled, actual])
    
    print(f"✓ Generated {len(data)} training samples in bus_data.csv")
    return data

def train_model():
    """Train the linear regression model using NumPy"""
    print("\nTraining Linear Regression Model (NumPy only)...")
    print("=" * 60)
    
    # Generate sample data
    data = generate_sample_data()
    
    # Prepare features (X) and target (y)
    X = np.array([[row[0], row[1]] for row in data])  # distance_km, traffic_level
    y = np.array([row[2] for row in data])  # eta_minutes
    
    # Split into train/test (80/20)
    split_idx = int(0.8 * len(X))
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    # Create and train model
    model = LinearRegressionNumpy()
    model.fit(X_train, y_train, learning_rate=0.01, epochs=1000)
    
    # Evaluate model
    train_score = model.score(X_train, y_train)
    test_score = model.score(X_test, y_test)
    
    # Calculate MAE
    y_pred_test = model.predict(X_test)
    mae = np.mean(np.abs(y_test - y_pred_test))
    
    print(f"\n📊 Model Performance:")
    print(f"   Training R² Score: {train_score:.4f}")
    print(f"   Testing R² Score:  {test_score:.4f}")
    print(f"   Mean Absolute Error: {mae:.2f} minutes")
    print(f"\n📈 Model Parameters:")
    print(f"   Weights: {model.weights}")
    print(f"   Bias: {model.bias:.4f}")
    
    # Save model
    with open('model.pkl', 'wb') as f:
        pickle.dump(model, f)
    
    print(f"\n✓ Model saved to model.pkl")
    print(f"✓ Model size: {os.path.getsize('model.pkl')} bytes (~{os.path.getsize('model.pkl')/1024:.1f} KB)")
    
    # Test predictions
    print(f"\n🧪 Sample Predictions:")
    test_cases = [
        [1.0, 1],    # 1km, low traffic
        [5.0, 1.5],  # 5km, medium traffic
        [3.0, 2],    # 3km, high traffic
    ]
    
    for distance, traffic in test_cases:
        prediction = model.predict(np.array([[distance, traffic]]))[0]
        print(f"   {distance}km, traffic level {traffic}: {prediction:.1f} minutes")
    
    print("\n" + "=" * 60)
    print("✅ Training complete! You can now run app.py")

if __name__ == '__main__':
    import os
    train_model()
