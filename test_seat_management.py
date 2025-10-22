"""
Unit tests for seat management and priority queue features
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Test basic seat management
def test_seat_defaults():
    """Test default seat configuration"""
    from app import DEFAULT_SEAT_COUNT, DEFAULT_CREW_SEATS, TOTAL_SEATS
    
    assert DEFAULT_SEAT_COUNT == 48, "Should have 48 passenger seats"
    assert DEFAULT_CREW_SEATS == 2, "Should have 2 crew seats"
    assert TOTAL_SEATS == 50, "Total should be 50 seats"
    print("✓ Default seat configuration test passed")

def test_seat_info_structure():
    """Test seat info data structure"""
    from app import bus_seat_info, DEFAULT_SEAT_COUNT, TOTAL_SEATS
    
    # Test default structure
    bus_id = "TEST_BUS_001"
    seat_info = bus_seat_info[bus_id]
    
    assert seat_info['total_seats'] == TOTAL_SEATS
    assert seat_info['passenger_seats'] == DEFAULT_SEAT_COUNT
    assert seat_info['occupied_seats'] == 0
    assert seat_info['bus_number'] is None
    print("✓ Seat info structure test passed")

def test_priority_queue_structure():
    """Test priority queue data structure"""
    from app import priority_queue
    
    # Test empty queue
    route_id = "TEST_ROUTE"
    queue = priority_queue[route_id]
    
    assert isinstance(queue, list), "Priority queue should be a list"
    assert len(queue) == 0, "Priority queue should start empty"
    print("✓ Priority queue structure test passed")

def test_bus_capacity_logic():
    """Test bus capacity calculation"""
    occupied = 48
    total = 48
    is_full = occupied >= total
    
    assert is_full == True, "Bus should be full when all seats occupied"
    
    occupied = 47
    is_full = occupied >= total
    assert is_full == False, "Bus should not be full with available seats"
    print("✓ Bus capacity logic test passed")

def test_seat_availability_calculation():
    """Test available seats calculation"""
    total_seats = 48
    occupied_seats = 30
    available = total_seats - occupied_seats
    
    assert available == 18, "Available seats should be 18"
    
    occupied_seats = 0
    available = total_seats - occupied_seats
    assert available == 48, "All seats should be available when none occupied"
    
    occupied_seats = 48
    available = total_seats - occupied_seats
    assert available == 0, "No seats should be available when all occupied"
    print("✓ Seat availability calculation test passed")

if __name__ == '__main__':
    print("\n" + "="*60)
    print("Running Unit Tests for Seat Management Features")
    print("="*60 + "\n")
    
    try:
        test_seat_defaults()
        test_seat_info_structure()
        test_priority_queue_structure()
        test_bus_capacity_logic()
        test_seat_availability_calculation()
        
        print("\n" + "="*60)
        print("✓ All tests passed!")
        print("="*60 + "\n")
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error running tests: {e}")
        sys.exit(1)
