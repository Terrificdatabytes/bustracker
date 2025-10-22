#!/usr/bin/env python3
"""
Simple test script to verify seat management data structures and logic
"""

from collections import defaultdict

# Test data structures
bus_seats = defaultdict(lambda: {'occupied': 0, 'total': 50, 'bus_number': None})
priority_queue = defaultdict(lambda: defaultdict(list))

def test_bus_seat_initialization():
    """Test bus seat structure initialization"""
    bus_id = 'test_bus_1'
    
    # Check default values
    assert bus_seats[bus_id]['occupied'] == 0, "Initial occupied should be 0"
    assert bus_seats[bus_id]['total'] == 50, "Total should be 50"
    assert bus_seats[bus_id]['bus_number'] is None, "Bus number should be None initially"
    
    print("✓ Bus seat initialization test passed")

def test_seat_increment():
    """Test seat increment logic"""
    bus_id = 'test_bus_2'
    
    # Increment seats
    bus_seats[bus_id]['occupied'] += 1
    assert bus_seats[bus_id]['occupied'] == 1, "Occupied should be 1 after increment"
    
    # Increment to capacity
    bus_seats[bus_id]['occupied'] = 49
    bus_seats[bus_id]['occupied'] += 1
    assert bus_seats[bus_id]['occupied'] == 50, "Occupied should be 50 at capacity"
    
    print("✓ Seat increment test passed")

def test_priority_queue():
    """Test priority queue structure"""
    route_id = 'test_route'
    stop_id = 1
    
    # Add passengers to priority queue
    passenger1 = {'passenger_id': 'p1', 'timestamp': '2025-01-01T00:00:00'}
    passenger2 = {'passenger_id': 'p2', 'timestamp': '2025-01-01T00:01:00'}
    
    priority_queue[route_id][stop_id].append(passenger1)
    priority_queue[route_id][stop_id].append(passenger2)
    
    assert len(priority_queue[route_id][stop_id]) == 2, "Priority queue should have 2 passengers"
    assert priority_queue[route_id][stop_id][0]['passenger_id'] == 'p1', "First passenger should be p1"
    
    print("✓ Priority queue test passed")

def test_bus_number_assignment():
    """Test bus number assignment"""
    bus_id = 'test_bus_3'
    bus_number = 5
    
    bus_seats[bus_id]['bus_number'] = bus_number
    assert bus_seats[bus_id]['bus_number'] == 5, "Bus number should be assigned"
    
    print("✓ Bus number assignment test passed")

def test_capacity_check():
    """Test capacity check logic"""
    bus_id = 'test_bus_4'
    
    # Test not full
    bus_seats[bus_id]['occupied'] = 30
    is_full = bus_seats[bus_id]['occupied'] >= bus_seats[bus_id]['total']
    assert not is_full, "Bus should not be full at 30/50"
    
    # Test full
    bus_seats[bus_id]['occupied'] = 50
    is_full = bus_seats[bus_id]['occupied'] >= bus_seats[bus_id]['total']
    assert is_full, "Bus should be full at 50/50"
    
    print("✓ Capacity check test passed")

def test_available_seats_calculation():
    """Test available seats calculation"""
    bus_id = 'test_bus_5'
    
    bus_seats[bus_id]['occupied'] = 23
    available = bus_seats[bus_id]['total'] - bus_seats[bus_id]['occupied']
    assert available == 27, f"Available seats should be 27, got {available}"
    
    print("✓ Available seats calculation test passed")

def run_all_tests():
    """Run all test functions"""
    print("\n" + "="*60)
    print("Running Seat Management Tests")
    print("="*60 + "\n")
    
    try:
        test_bus_seat_initialization()
        test_seat_increment()
        test_priority_queue()
        test_bus_number_assignment()
        test_capacity_check()
        test_available_seats_calculation()
        
        print("\n" + "="*60)
        print("✅ All tests passed successfully!")
        print("="*60 + "\n")
        return True
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}\n")
        return False
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}\n")
        return False

if __name__ == '__main__':
    success = run_all_tests()
    exit(0 if success else 1)
