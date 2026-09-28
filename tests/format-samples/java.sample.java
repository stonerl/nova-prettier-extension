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
