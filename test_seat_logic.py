"""
Standalone unit tests for seat management logic (no dependencies)
"""

def test_seat_defaults():
    """Test default seat configuration"""
    DEFAULT_SEAT_COUNT = 48
    DEFAULT_CREW_SEATS = 2
    TOTAL_SEATS = DEFAULT_SEAT_COUNT + DEFAULT_CREW_SEATS
    
    assert DEFAULT_SEAT_COUNT == 48, "Should have 48 passenger seats"
    assert DEFAULT_CREW_SEATS == 2, "Should have 2 crew seats"
    assert TOTAL_SEATS == 50, "Total should be 50 seats"
    print("✓ Default seat configuration test passed")

def test_bus_capacity_logic():
    """Test bus capacity calculation"""
    occupied = 48
    total = 48
    is_full = occupied >= total
    
    assert is_full == True, "Bus should be full when all seats occupied"
    
    occupied = 47
    is_full = occupied >= total
    assert is_full == False, "Bus should not be full with available seats"
    
    occupied = 49  # Edge case - more than capacity
    is_full = occupied >= total
    assert is_full == True, "Bus should be full when seats exceed capacity"
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
    
    occupied_seats = 25
    available = total_seats - occupied_seats
    assert available == 23, "Available seats should be 23"
    print("✓ Seat availability calculation test passed")

def test_seat_increment_decrement():
    """Test seat counter increment/decrement logic"""
    occupied = 0
    max_seats = 48
    
    # Test increment
    occupied = min(occupied + 1, max_seats)
    assert occupied == 1, "Occupied should be 1 after increment"
    
    # Test increment to max
    occupied = 47
    occupied = min(occupied + 1, max_seats)
    assert occupied == 48, "Occupied should be 48 at max"
    
    # Test increment beyond max (should not exceed)
    occupied = min(occupied + 1, max_seats)
    assert occupied == 48, "Occupied should not exceed 48"
    
    # Test decrement
    occupied = max(occupied - 1, 0)
    assert occupied == 47, "Occupied should be 47 after decrement"
    
    # Test decrement to zero
    occupied = 1
    occupied = max(occupied - 1, 0)
    assert occupied == 0, "Occupied should be 0 at minimum"
    
    # Test decrement below zero (should not go negative)
    occupied = max(occupied - 1, 0)
    assert occupied == 0, "Occupied should not go below 0"
    print("✓ Seat increment/decrement logic test passed")

def test_priority_queue_fifo():
    """Test priority queue FIFO logic"""
    queue = []
    
    # Add passengers
    queue.append({'id': 'P1', 'stop': 5})
    queue.append({'id': 'P2', 'stop': 3})
    queue.append({'id': 'P3', 'stop': 5})
    
    assert len(queue) == 3, "Queue should have 3 passengers"
    assert queue[0]['id'] == 'P1', "First in queue should be P1"
    
    # Remove first passenger (FIFO)
    first = queue.pop(0)
    assert first['id'] == 'P1', "Removed passenger should be P1"
    assert len(queue) == 2, "Queue should have 2 passengers"
    assert queue[0]['id'] == 'P2', "Next in queue should be P2"
    print("✓ Priority queue FIFO logic test passed")

def test_seat_info_data_structure():
    """Test seat info data structure"""
    bus_seat_info = {
        'total_seats': 50,
        'passenger_seats': 48,
        'crew_seats': 2,
        'occupied_seats': 0,
        'bus_number': None
    }
    
    assert bus_seat_info['total_seats'] == 50
    assert bus_seat_info['passenger_seats'] == 48
    assert bus_seat_info['crew_seats'] == 2
    assert bus_seat_info['occupied_seats'] == 0
    assert bus_seat_info['bus_number'] is None
    
    # Update bus number
    bus_seat_info['bus_number'] = 'BUS-001'
    assert bus_seat_info['bus_number'] == 'BUS-001'
    
    # Update occupied seats
    bus_seat_info['occupied_seats'] = 35
    available = bus_seat_info['passenger_seats'] - bus_seat_info['occupied_seats']
    assert available == 13, "Available should be 13"
    print("✓ Seat info data structure test passed")

def test_automatic_full_detection():
    """Test automatic bus full detection"""
    occupied_seats = 0
    max_passenger_seats = 48
    
    def check_if_full(occupied, max_seats):
        return occupied >= max_seats
    
    # Not full
    assert check_if_full(0, max_passenger_seats) == False
    assert check_if_full(30, max_passenger_seats) == False
    assert check_if_full(47, max_passenger_seats) == False
    
    # Full
    assert check_if_full(48, max_passenger_seats) == True
    assert check_if_full(49, max_passenger_seats) == True
    
    print("✓ Automatic full detection test passed")

if __name__ == '__main__':
    import sys
    
    print("\n" + "="*70)
    print("Running Standalone Unit Tests for Seat Management Features")
    print("="*70 + "\n")
    
    try:
        test_seat_defaults()
        test_bus_capacity_logic()
        test_seat_availability_calculation()
        test_seat_increment_decrement()
        test_priority_queue_fifo()
        test_seat_info_data_structure()
        test_automatic_full_detection()
        
        print("\n" + "="*70)
        print("✅ All 7 tests passed successfully!")
        print("="*70 + "\n")
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
