// Basic class structure
public class Test {

  // Fields
  private int number;
  private String message = "Hello";

  // Constructor
  public Test(int number) {
    this.number = number;
  }

  // Methods
  public void greet(String name) {
    if (name == null || name.isEmpty()) {
      System.out.println("Hello, world!");
    } else {
      System.out.println("Hello, " + name + "!");
    }
  }

  public int add(int a, int b) {
    return a + b;
  }

  // Static method
  public static void main(String[] args) {
    Test t = new Test(42);
    t.greet("Nova");
    System.out.println("Sum: " + t.add(5, 3));
  }
}

// Interface with default methods
interface Greeter {
  String name();

  default String greet() {
    return "Hello, " + name() + "!";
  }
}

// Enum
enum Status {
  ACTIVE("on"),
  INACTIVE("off");

  private final String label;

  Status(String label) {
    this.label = label;
  }

  String label() {
    return label;
  }
}

// Generic method
public static <T extends Comparable<T>> T max(T a, T b) {
  return a.compareTo(b) >= 0 ? a : b;
}

// Record
record Point(int x, int y) {
  Point translated(int dx, int dy) {
    return new Point(x + dx, y + dy);
  }
}

// Switch expression
static int daysInMonth(Month month, boolean leapYear) {
  return switch (month) {
    case FEBRUARY -> leapYear ? 29 : 28;
    case APRIL, JUNE, SEPTEMBER, NOVEMBER -> 30;
    default -> 31;
  };
}
