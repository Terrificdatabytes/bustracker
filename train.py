import numpy as np
import pickle
import csv
from model_class import LinearRegressionNumpy
import pandas as pd
import os
from datetime import datetime

# Import or define the model class
try:
    from model_class import LinearRegressionNumpy
except ImportError:
    # Define it inline if model_class.py doesn't exist
    class LinearRegressionNumpy:
        """Simple Linear Regression using only NumPy"""
        def __init__(self):
            self.weights = None
            self.bias = None
        
        def fit(self, X, y, learning_rate=0.01, epochs=1000):
            n_samples, n_features = X.shape
            self.weights = np.zeros(n_features)
            self.bias = 0
            for _ in range(epochs):
                y_pred = np.dot(X, self.weights) + self.bias
                dw = (1/n_samples) * np.dot(X.T, (y_pred - y))
                db = (1/n_samples) * np.sum(y_pred - y)
                self.weights -= learning_rate * dw
                self.bias -= learning_rate * db
        
        def predict(self, X):
            return np.dot(X, self.weights) + self.bias
        
        def score(self, X, y):
            y_pred = self.predict(X)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            ss_res = np.sum((y - y_pred) ** 2)
            return 1 - (ss_res / ss_tot)

def load_historical_data():
    """Load and process historical bus location data"""
    print("=" * 70)
    print("📊 Loading Historical Bus Location Data")
    print("=" * 70)
    
    if not os.path.isfile('bus_locations.csv'):
        print("⚠ No historical data found in bus_locations.csv")
        print("📝 Generating sample training data instead...")
        return generate_sample_data()
    
    try:
        df = pd.read_csv('bus_locations.csv')
        print(f"✓ Loaded {len(df)} records from bus_locations.csv")
        
        if len(df) < 10:
            print("⚠ Insufficient historical data (< 10 records)")
            print("📝 Combining with sample data...")
            sample_data = generate_sample_data()
            return sample_data
        
        # Extract features
        X = df[['distance_to_stop_km', 'traffic_level']].values
        
        # Calculate actual time based on speed and distance
        # ETA (minutes) = (distance_km / speed_kmh) * 60
        # If speed is 0, use fallback calculation
        y = []
        for idx, row in df.iterrows():
            distance = row['distance_to_stop_km']
            traffic = row['traffic_level']
            speed = row['speed_kmh']
            
            if speed > 0:
                eta = (distance / speed) * 60  # Convert to minutes
            else:
                # Fallback: use traffic-adjusted speed
                base_speed = 30  # km/h
                adjusted_speed = base_speed / traffic if traffic > 0 else base_speed
                eta = (distance / adjusted_speed) * 60
            
            y.append(max(0.5, eta))  # Minimum 0.5 minutes
        
        y = np.array(y)
        
        print(f"✓ Processed {len(X)} training samples")
        print(f"  - Distance range: {X[:, 0].min():.2f} to {X[:, 0].max():.2f} km")
        print(f"  - Traffic range: {X[:, 1].min():.2f} to {X[:, 1].max():.2f}")
        print(f"  - ETA range: {y.min():.2f} to {y.max():.2f} minutes")
        
        return X, y
        
    except Exception as e:
        print(f"✗ Error loading historical data: {e}")
        print("📝 Generating sample training data instead...")
        return generate_sample_data()

def generate_sample_data():
    """Generate sample training data"""
    print("\n📝 Generating Sample Training Data...")
    
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
        
        # Add realistic variance
        [1.2, 1, 2.5],
        [2.5, 1.5, 7.5],
        [3.5, 2, 14.0],
        [4.5, 1, 9.0],
        [6.0, 2, 24.0],
        
        # Very short distances
        [0.1, 1, 0.2],
        [0.2, 1.5, 0.5],
        [0.3, 2, 0.9],
        
        # Edge cases
        [0.05, 1, 0.1],
        [15.0, 1, 30.0],
        [12.0, 2.5, 48.0],
    ]
    
    X = np.array([[row[0], row[1]] for row in data])
    y = np.array([row[2] for row in data])
    
    print(f"✓ Generated {len(data)} training samples")
    
    return X, y

def train_model():
    """Train the linear regression model"""
    print("\n" + "=" * 70)
    print("🚀 Training Enhanced ML Model for Bus ETA Prediction")
    print("=" * 70)
    
    # Load data (historical or sample)
    X, y = load_historical_data()
    
    # Split into train/test (80/20)
    split_idx = int(0.8 * len(X))
    indices = np.random.permutation(len(X))
    train_indices = indices[:split_idx]
    test_indices = indices[split_idx:]
    
    X_train, X_test = X[train_indices], X[test_indices]
    y_train, y_test = y[train_indices], y[test_indices]
    
    print(f"\n📊 Dataset Split:")
    print(f"  - Training samples: {len(X_train)}")
    print(f"  - Testing samples: {len(X_test)}")
    
    # Create and train model
    print(f"\n⚙️ Training Linear Regression Model...")
    model = LinearRegressionNumpy()
    model.fit(X_train, y_train, learning_rate=0.01, epochs=2000)
    
    # Evaluate model
    train_score = model.score(X_train, y_train)
    test_score = model.score(X_test, y_test)
    
    # Calculate metrics
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)
    
    mae_train = np.mean(np.abs(y_train - y_pred_train))
    mae_test = np.mean(np.abs(y_test - y_pred_test))
    
    rmse_train = np.sqrt(np.mean((y_train - y_pred_train) ** 2))
    rmse_test = np.sqrt(np.mean((y_test - y_pred_test) ** 2))
    
    print(f"\n✅ Model Training Complete!")
    print(f"\n📈 Model Performance Metrics:")
    print(f"  {'Metric':<20} {'Training':<15} {'Testing':<15}")
    print(f"  {'-'*20} {'-'*15} {'-'*15}")
    print(f"  {'R² Score':<20} {train_score:<15.4f} {test_score:<15.4f}")
    print(f"  {'MAE (minutes)':<20} {mae_train:<15.2f} {mae_test:<15.2f}")
    print(f"  {'RMSE (minutes)':<20} {rmse_train:<15.2f} {rmse_test:<15.2f}")
    
    print(f"\n🔧 Model Parameters:")
    print(f"  - Weight (Distance): {model.weights[0]:.4f}")
    print(f"  - Weight (Traffic):  {model.weights[1]:.4f}")
    print(f"  - Bias:              {model.bias:.4f}")
    
    # Save model
    with open('model.pkl', 'wb') as f:
        pickle.dump(model, f)
    
    model_size = os.path.getsize('model.pkl')
    print(f"\n💾 Model saved to model.pkl")
    print(f"  - Size: {model_size} bytes (~{model_size/1024:.1f} KB)")
    
    # Test predictions with various scenarios
    print(f"\n🧪 Sample Predictions:")
    print(f"  {'Distance':<12} {'Traffic':<12} {'Predicted ETA':<15} {'Expected':<15}")
    print(f"  {'-'*12} {'-'*12} {'-'*15} {'-'*15}")
    
    test_cases = [
        ([0.5, 1], "~1 min"),
        ([1.0, 1], "~2 min"),
        ([2.0, 1.5], "~6 min"),
        ([5.0, 1.5], "~15 min"),
        ([3.0, 2], "~12 min"),
        ([10.0, 2], "~40 min"),
        ([0.1, 1], "<1 min"),
    ]
    
    for (distance, traffic), expected in test_cases:
        prediction = model.predict(np.array([[distance, traffic]]))[0]
        print(f"  {f'{distance} km':<12} {f'{traffic}x':<12} {f'{prediction:.1f} min':<15} {expected:<15}")
    
    print("\n" + "=" * 70)
    print("✅ Training Complete! Model is ready for deployment.")
    print("=" * 70)
    print("\n💡 Next Steps:")
    print("  1. Run 'python app.py' to start the bus tracking server")
    print("  2. The model will automatically load and provide ETA predictions")
    print("  3. As buses operate, more data will be collected in bus_locations.csv")
    print("  4. Retrain periodically with: python train.py")
    print("\n" + "=" * 70)

def analyze_historical_data():
    """Analyze historical data if available"""
    if not os.path.isfile('bus_locations.csv'):
        return
    
    try:
        df = pd.read_csv('bus_locations.csv')
        
        if len(df) == 0:
            return
        
        print("\n" + "=" * 70)
        print("📊 Historical Data Analysis")
        print("=" * 70)
        
        print(f"\n📅 Data Collection Period:")
        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            print(f"  - First record: {df['timestamp'].min()}")
            print(f"  - Last record:  {df['timestamp'].max()}")
            print(f"  - Duration:     {(df['timestamp'].max() - df['timestamp'].min()).days} days")
        
        print(f"\n🚌 Bus Statistics:")
        if 'bus_id' in df.columns:
            print(f"  - Unique buses: {df['bus_id'].nunique()}")
            print(f"  - Total trips:  {len(df)}")
        
        if 'route_id' in df.columns:
            print(f"\n🛣️ Route Statistics:")
            route_counts = df['route_id'].value_counts()
            for route, count in route_counts.items():
                print(f"  - Route {route}: {count} records")
        
        if 'speed_kmh' in df.columns:
            print(f"\n⚡ Speed Statistics:")
            print(f"  - Average speed: {df['speed_kmh'].mean():.2f} km/h")
            print(f"  - Max speed:     {df['speed_kmh'].max():.2f} km/h")
            print(f"  - Min speed:     {df['speed_kmh'].min():.2f} km/h")
        
        if 'traffic_level' in df.columns:
            print(f"\n🚦 Traffic Statistics:")
            print(f"  - Average traffic: {df['traffic_level'].mean():.2f}")
            print(f"  - Max traffic:     {df['traffic_level'].max():.2f}")
        
        print("\n" + "=" * 70)
        
    except Exception as e:
        print(f"Error analyzing data: {e}")

if __name__ == '__main__':
    print("\n")
    print("╔" + "═" * 68 + "╗")
    print("║" + " " * 15 + "🚌 Bus Tracking ML Model Trainer" + " " * 20 + "║")
    print("╚" + "═" * 68 + "╝")
    print()
    
    # Analyze existing data
    analyze_historical_data()
    
    # Train model
    train_model()
    
    print("\n🎉 All done! Happy tracking!\n")
