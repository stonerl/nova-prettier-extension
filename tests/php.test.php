<?php

declare(strict_types=1);

// Variable declarations with inconsistent spacing
$foo = "bar";
$baz = ["one", "two", "three"];

// Functions with messy formatting
function greet($name = "World")
{
    return "Hello, $name!";
}

// Class with properties, methods, visibility
class User
{
    public $name;
    private $email;

    public function __construct($name, $email)
    {
        $this->name = $name;
        $this->email = $email;
    }

    public function getName()
    {
        return $this->name;
    }

    public function getEmail()
    {
        return $this->email;
    }
}

// Conditionals and loops
for ($i = 0; $i < 10; $i++) {
    if ($i % 2 === 0) {
        echo "$i is even\n";
    } else {
        echo "$i is odd\n";
    }
}

// Arrays: short vs long syntax, spacing, trailing commas
$data = [
    "name" => "Alice",
    "age" => 30,
    "languages" => ["PHP", "JavaScript"],
];

// Inline HTML
?>
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1><?php echo $foo; ?></h1>
</body>
</html>
<?php
// Anonymous functions and closures
$log = function ($message) use ($foo) {
    echo "[LOG] $message - $foo\n";
};

// Namespaces and use statements
namespace App\Controllers;
use App\Models\User as UserModel;

// Match expressions
$value = match ($foo) {
    "bar" => 1,
    "baz" => 2,
    default => 0,
};

