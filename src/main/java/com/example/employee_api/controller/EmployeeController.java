package com.example.employee_api.controller;

import com.example.employee_api.model.Employee;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
public class EmployeeController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello from Spring Boot running on ECS EC2!";
    }

    @GetMapping("/employees")
    public List<Employee> getEmployees() {

        return List.of(
                new Employee(1, "Abdul", "Developer"),
                new Employee(2, "John", "DevOps Engineer"),
                new Employee(3, "Sarah", "Cloud Engineer")
        );
    }
}